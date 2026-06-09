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
    DELETE FROM file_nodes
    WHERE status = 'deleted'
      AND modified_at < NOW() - INTERVAL 30 DAY;
END //

DELIMITER ;
