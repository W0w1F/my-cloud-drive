-- 006-events.sql: Event Scheduler — Automated Cleanup
-- Feature: 002-frontend-ux
-- Constitution VI: Event-driven cleanup, no external cron scripts

USE cloud_drive;

DROP EVENT IF EXISTS evt_clean_recycle_bin;

DELIMITER //

CREATE EVENT evt_clean_recycle_bin
ON SCHEDULE
    EVERY 1 DAY
    STARTS CURRENT_DATE + INTERVAL 2 HOUR
ON COMPLETION PRESERVE
ENABLE
COMMENT 'Physically delete soft-deleted file_nodes older than 30 days'
DO
BEGIN
    DECLARE v_batch_deleted INT DEFAULT 0;

    delete_loop: LOOP
        DELETE fn
        FROM file_nodes fn
        LEFT JOIN file_nodes child ON child.parent_id = fn.id
        WHERE fn.status = 'deleted'
          AND fn.modified_at < NOW() - INTERVAL 30 DAY
          AND child.id IS NULL;

        SET v_batch_deleted = ROW_COUNT();

        IF v_batch_deleted = 0 THEN
            LEAVE delete_loop;
        END IF;
    END LOOP;
END //

DELIMITER ;
