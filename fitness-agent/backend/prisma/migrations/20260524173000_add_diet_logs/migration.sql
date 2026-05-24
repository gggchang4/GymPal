CREATE TABLE "DietLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mealType" TEXT NOT NULL DEFAULT 'meal',
  "foods" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "totalCalorie" INTEGER,
  "proteinGrams" DOUBLE PRECISION,
  "carbohydrateGrams" DOUBLE PRECISION,
  "fatGrams" DOUBLE PRECISION,
  "note" TEXT,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL DEFAULT 'manual',

  CONSTRAINT "DietLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DietLog_userId_recordedAt_idx" ON "DietLog"("userId", "recordedAt");

ALTER TABLE "DietLog"
ADD CONSTRAINT "DietLog_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
