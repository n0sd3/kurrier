CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT
  nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
 NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"workspace_id" uuid DEFAULT
  nullif(current_setting('request.jwt.claim.workspace_id', true), '')::uuid
 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_push_subscription_endpoint" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "ix_push_subscriptions_owner" ON "push_subscriptions" USING btree ("owner_id");--> statement-breakpoint
CREATE POLICY "push_subscriptions_select_workspace" ON "push_subscriptions" AS PERMISSIVE FOR SELECT TO "kurrier" USING ("push_subscriptions"."workspace_id" =
  nullif(current_setting('request.jwt.claim.workspace_id', true), '')::uuid
);--> statement-breakpoint
CREATE POLICY "push_subscriptions_insert_workspace" ON "push_subscriptions" AS PERMISSIVE FOR INSERT TO "kurrier" WITH CHECK ("push_subscriptions"."workspace_id" =
  nullif(current_setting('request.jwt.claim.workspace_id', true), '')::uuid
);--> statement-breakpoint
CREATE POLICY "push_subscriptions_update_workspace" ON "push_subscriptions" AS PERMISSIVE FOR UPDATE TO "kurrier" USING ("push_subscriptions"."workspace_id" =
  nullif(current_setting('request.jwt.claim.workspace_id', true), '')::uuid
) WITH CHECK ("push_subscriptions"."workspace_id" =
  nullif(current_setting('request.jwt.claim.workspace_id', true), '')::uuid
);--> statement-breakpoint
CREATE POLICY "push_subscriptions_delete_workspace" ON "push_subscriptions" AS PERMISSIVE FOR DELETE TO "kurrier" USING ("push_subscriptions"."workspace_id" =
  nullif(current_setting('request.jwt.claim.workspace_id', true), '')::uuid
);--> statement-breakpoint
