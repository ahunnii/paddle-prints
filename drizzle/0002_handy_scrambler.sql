CREATE TABLE "paddle-prints_paddles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"route_id" uuid,
	"trip_type" "route_type" NOT NULL,
	"started_at" timestamp NOT NULL,
	"elapsed_s" integer NOT NULL,
	"moving_s" integer NOT NULL,
	"distance_m" real NOT NULL,
	"avg_speed_mps" real NOT NULL,
	"track_geom" geometry(LineString,4326),
	"track_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paddle-prints_pois" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"category" "poi_category" NOT NULL,
	"note" text,
	"geom" geometry(Point,4326) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paddle-prints_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "route_type" NOT NULL,
	"shape" "route_shape" DEFAULT 'one_way' NOT NULL,
	"geom" geometry(LineString,4326) NOT NULL,
	"distance_m" real NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paddle-prints_paddles" ADD CONSTRAINT "paddle-prints_paddles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_paddles" ADD CONSTRAINT "paddle-prints_paddles_route_id_paddle-prints_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."paddle-prints_routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_pois" ADD CONSTRAINT "paddle-prints_pois_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paddle-prints_routes" ADD CONSTRAINT "paddle-prints_routes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paddles_userId_idx" ON "paddle-prints_paddles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "paddles_routeId_idx" ON "paddle-prints_paddles" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "pois_geom_idx" ON "paddle-prints_pois" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "routes_geom_idx" ON "paddle-prints_routes" USING gist ("geom");