-- TASK 013 (HR): رمز حالة الحضور اليومية (غ، س، ع، م، ز، ج، حظر، مأمورية…).
-- إضافية بحتة: عمود واحد اختياري على attendance_daily_records. لا يغيّر أي سجل قائم،
-- ولا يؤثر على الرواتب؛ أثر الحالات يُحسب كمعاينة فقط (انظر attendanceStatus.ts).
ALTER TABLE attendance_daily_records
  ADD COLUMN IF NOT EXISTS status_code text;

ALTER TABLE attendance_daily_records
  DROP CONSTRAINT IF EXISTS attendance_daily_records_status_code_chk;
ALTER TABLE attendance_daily_records
  ADD CONSTRAINT attendance_daily_records_status_code_chk CHECK (
    status_code IS NULL OR status_code IN (
      'UNAUTH_ABSENCE', 'ANNUAL', 'CASUAL', 'SICK', 'MARRIAGE', 'PERMITTED_ABSENCE',
      'BAN', 'COMP_LEAVE', 'MISSION_LEAVE', 'OFFICIAL_HOLIDAY', 'REST', 'MISSION'
    )
  );

CREATE INDEX IF NOT EXISTS idx_attendance_daily_records_status
  ON attendance_daily_records(company_id, employee_id, attendance_date)
  WHERE status_code IS NOT NULL;
