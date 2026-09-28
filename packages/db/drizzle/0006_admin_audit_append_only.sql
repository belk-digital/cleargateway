-- The admin audit log is append-only, like payment_events and the ledger (forbid_mutation() comes from 0001).
CREATE TRIGGER admin_audit_log_append_only
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
