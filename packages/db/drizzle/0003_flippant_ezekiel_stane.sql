CREATE TABLE "paddle-prints_presence" (
	"user_id" text PRIMARY KEY NOT NULL,
	"geom" geometry(Point,4326) NOT NULL,
	"trip_type" "route_type" NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paddle-prints_paddles" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "paddle-prints_routes" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "paddle-prints_presence" ADD CONSTRAINT "paddle-prints_presence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;