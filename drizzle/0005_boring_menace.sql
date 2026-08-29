CREATE INDEX "artifacts_subject_created" ON "artifacts" USING btree ("subject_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_subject_skill" ON "runs" USING btree ("subject_id","skill");