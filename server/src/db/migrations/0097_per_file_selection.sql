ALTER TABLE "book_request_downloads" ADD COLUMN "file_index" integer;--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD COLUMN "file_selection_pending_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD COLUMN "selected_file_path" text;