-- Remove the standalone quarterly KPI% feature per product decision:
-- Scoring (monthly) stays; KPI (quarterly) is being removed entirely,
-- including the auto-computed quarterly reward that was derived from it.
DROP TABLE "QuarterlyKpi";
