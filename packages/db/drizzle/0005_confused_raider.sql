CREATE TYPE "public"."route_difficulty" AS ENUM('easy', 'moderate', 'challenging', 'hard');--> statement-breakpoint
ALTER TABLE "paddle-prints_routes" ADD COLUMN "difficulty" "route_difficulty";