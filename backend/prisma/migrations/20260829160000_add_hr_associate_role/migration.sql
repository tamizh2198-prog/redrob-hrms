-- Reintroduce HR_ASSOCIATE (previously removed in 20260828140000). New
-- design: mirrors HR_ADMIN everywhere except approve/reject/decide/audit
-- authority, enforced entirely in application code — this migration only
-- needs to add the enum value, since ADD VALUE (unlike removal) doesn't
-- require a full type rebuild.
ALTER TYPE "Role" ADD VALUE 'HR_ASSOCIATE';
