CREATE TABLE "paddle-prints_paddle_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"paddle_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paddle-prints_paddle_crew" (
	"paddle_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paddle-prints_paddle_crew_paddle_id_user_id_pk" PRIMARY KEY("paddle_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "paddle-prints_paddle_pins" (
	"user_id" text NOT NULL,
	"paddle_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paddle-prints_paddle_pins_user_id_paddle_id_pk" PRIMARY KEY("user_id","paddle_id")
);
--> statement-breakpoint
CREATE TABLE "paddle-prints_paddle_reactions" (
	"paddle_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paddle-prints_paddle_reactions_paddle_id_user_id_emoji_pk" PRIMARY KEY("paddle_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "paddle-prints_team_members" (
	"team_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paddle-prints_team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "paddle-prints_teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paddle-prints_paddles" ADD COLUMN "guest_names" jsonb;--> statement-breakpoint
ALTER TABLE "paddle-prints_paddle_comments" ADD CONSTRAINT "paddle-prints_paddle_comments_paddle_id_paddle-prints_paddles_id_fk" FOREIGN KEY ("paddle_id") REFERENCES "public"."paddle-prints_paddles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_paddle_comments" ADD CONSTRAINT "paddle-prints_paddle_comments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_paddle_crew" ADD CONSTRAINT "paddle-prints_paddle_crew_paddle_id_paddle-prints_paddles_id_fk" FOREIGN KEY ("paddle_id") REFERENCES "public"."paddle-prints_paddles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_paddle_crew" ADD CONSTRAINT "paddle-prints_paddle_crew_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_paddle_pins" ADD CONSTRAINT "paddle-prints_paddle_pins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_paddle_pins" ADD CONSTRAINT "paddle-prints_paddle_pins_paddle_id_paddle-prints_paddles_id_fk" FOREIGN KEY ("paddle_id") REFERENCES "public"."paddle-prints_paddles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_paddle_reactions" ADD CONSTRAINT "paddle-prints_paddle_reactions_paddle_id_paddle-prints_paddles_id_fk" FOREIGN KEY ("paddle_id") REFERENCES "public"."paddle-prints_paddles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_paddle_reactions" ADD CONSTRAINT "paddle-prints_paddle_reactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_team_members" ADD CONSTRAINT "paddle-prints_team_members_team_id_paddle-prints_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."paddle-prints_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_team_members" ADD CONSTRAINT "paddle-prints_team_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_team_members" ADD CONSTRAINT "paddle-prints_team_members_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_teams" ADD CONSTRAINT "paddle-prints_teams_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paddle_comments_paddleId_idx" ON "paddle-prints_paddle_comments" USING btree ("paddle_id");--> statement-breakpoint
CREATE INDEX "paddle_crew_userId_idx" ON "paddle-prints_paddle_crew" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "team_members_userId_idx" ON "paddle-prints_team_members" USING btree ("user_id");