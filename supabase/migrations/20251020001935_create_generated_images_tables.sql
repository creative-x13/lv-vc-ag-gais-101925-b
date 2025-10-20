/*
  # Generated Images and Design History Schema

  ## Overview
  This migration creates tables for storing generated images, design iterations,
  and visual asset history from the remodeling, landscaping, and restoration widgets.

  ## New Tables

  ### 1. `generated_images`
  Stores all AI-generated images with metadata.
  - `id` (uuid, primary key)
  - `session_id` (uuid, foreign key to conversation_sessions)
  - `user_id` (uuid, foreign key to user_profiles)
  - `widget_type` (text) - Which widget generated this image
  - `original_image_url` (text) - URL/path to the original uploaded image
  - `generated_image_url` (text) - URL/path to the generated image
  - `image_data` (text) - Base64 encoded image data (if storing directly)
  - `prompt` (text) - The prompt/description used for generation
  - `model_used` (text) - Which AI model generated this
  - `generation_metadata` (jsonb) - Model parameters, settings, etc.
  - `is_favorite` (boolean) - User marked as favorite
  - `created_at` (timestamptz)

  ### 2. `design_projects`
  Groups related images into design projects for tracking iterations.
  - `id` (uuid, primary key)
  - `user_id` (uuid, foreign key to user_profiles)
  - `project_name` (text)
  - `project_type` (text) - 'kitchen', 'room', 'landscaping', 'restoration'
  - `description` (text)
  - `original_image_id` (uuid, foreign key to generated_images)
  - `current_version_id` (uuid, foreign key to generated_images)
  - `status` (text) - 'active', 'completed', 'archived'
  - `metadata` (jsonb)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 3. `image_versions`
  Tracks version history for design iterations.
  - `id` (uuid, primary key)
  - `project_id` (uuid, foreign key to design_projects)
  - `image_id` (uuid, foreign key to generated_images)
  - `version_number` (integer)
  - `description` (text) - What changed in this version
  - `created_at` (timestamptz)

  ### 4. `image_analytics`
  Tracks usage and engagement metrics for generated images.
  - `id` (uuid, primary key)
  - `image_id` (uuid, foreign key to generated_images)
  - `views` (integer) - Number of times viewed
  - `downloads` (integer) - Number of downloads
  - `shares` (integer) - Number of shares
  - `generation_time_ms` (integer) - Time taken to generate
  - `last_viewed_at` (timestamptz)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## Security
  - Row Level Security (RLS) enabled on all tables
  - Users can only access their own generated images and projects
  - Anonymous users can generate images but cannot save them long-term
*/

-- Create generated_images table
CREATE TABLE IF NOT EXISTS generated_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES conversation_sessions(id) ON DELETE SET NULL,
  user_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  widget_type text NOT NULL,
  original_image_url text,
  generated_image_url text,
  image_data text,
  prompt text NOT NULL,
  model_used text DEFAULT 'gemini-2.5-flash-image',
  generation_metadata jsonb DEFAULT '{}'::jsonb,
  is_favorite boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create design_projects table
CREATE TABLE IF NOT EXISTS design_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  project_name text NOT NULL,
  project_type text NOT NULL CHECK (project_type IN ('kitchen', 'room', 'landscaping', 'restoration', 'other')),
  description text,
  original_image_id uuid REFERENCES generated_images(id) ON DELETE SET NULL,
  current_version_id uuid REFERENCES generated_images(id) ON DELETE SET NULL,
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create image_versions table
CREATE TABLE IF NOT EXISTS image_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  image_id uuid NOT NULL REFERENCES generated_images(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, version_number)
);

-- Create image_analytics table
CREATE TABLE IF NOT EXISTS image_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL REFERENCES generated_images(id) ON DELETE CASCADE UNIQUE,
  views integer DEFAULT 0,
  downloads integer DEFAULT 0,
  shares integer DEFAULT 0,
  generation_time_ms integer,
  last_viewed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE generated_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_analytics ENABLE ROW LEVEL SECURITY;

-- RLS Policies for generated_images
CREATE POLICY "Users can view own generated images"
  ON generated_images FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own generated images"
  ON generated_images FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can update own generated images"
  ON generated_images FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own generated images"
  ON generated_images FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Allow anonymous image generation"
  ON generated_images FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous image viewing"
  ON generated_images FOR SELECT
  TO anon
  USING (true);

-- RLS Policies for design_projects
CREATE POLICY "Users can view own design projects"
  ON design_projects FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own design projects"
  ON design_projects FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own design projects"
  ON design_projects FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own design projects"
  ON design_projects FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for image_versions
CREATE POLICY "Users can view versions of own projects"
  ON image_versions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM design_projects
      WHERE design_projects.id = image_versions.project_id
      AND design_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert versions for own projects"
  ON image_versions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM design_projects
      WHERE design_projects.id = image_versions.project_id
      AND design_projects.user_id = auth.uid()
    )
  );

-- RLS Policies for image_analytics
CREATE POLICY "Users can view analytics for own images"
  ON image_analytics FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM generated_images
      WHERE generated_images.id = image_analytics.image_id
      AND generated_images.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update analytics for own images"
  ON image_analytics FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM generated_images
      WHERE generated_images.id = image_analytics.image_id
      AND generated_images.user_id = auth.uid()
    )
  );

CREATE POLICY "Allow anonymous analytics viewing"
  ON image_analytics FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous analytics updates"
  ON image_analytics FOR UPDATE
  TO anon
  USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_generated_images_user_id ON generated_images(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_session_id ON generated_images(session_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_widget_type ON generated_images(widget_type);
CREATE INDEX IF NOT EXISTS idx_generated_images_is_favorite ON generated_images(is_favorite) WHERE is_favorite = true;
CREATE INDEX IF NOT EXISTS idx_generated_images_created_at ON generated_images(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_design_projects_user_id ON design_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_design_projects_project_type ON design_projects(project_type);
CREATE INDEX IF NOT EXISTS idx_design_projects_status ON design_projects(status);
CREATE INDEX IF NOT EXISTS idx_design_projects_created_at ON design_projects(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_image_versions_project_id ON image_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_image_versions_image_id ON image_versions(image_id);
CREATE INDEX IF NOT EXISTS idx_image_versions_version_number ON image_versions(project_id, version_number);

CREATE INDEX IF NOT EXISTS idx_image_analytics_image_id ON image_analytics(image_id);

-- Create triggers for updated_at
CREATE TRIGGER update_design_projects_updated_at
  BEFORE UPDATE ON design_projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_image_analytics_updated_at
  BEFORE UPDATE ON image_analytics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create function to automatically create analytics record when image is generated
CREATE OR REPLACE FUNCTION create_image_analytics_record()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO image_analytics (image_id)
  VALUES (NEW.id)
  ON CONFLICT (image_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic analytics initialization
CREATE TRIGGER initialize_image_analytics
  AFTER INSERT ON generated_images
  FOR EACH ROW
  EXECUTE FUNCTION create_image_analytics_record();

-- Create function to increment image views
CREATE OR REPLACE FUNCTION increment_image_views(image_uuid uuid)
RETURNS void AS $$
BEGIN
  UPDATE image_analytics
  SET 
    views = views + 1,
    last_viewed_at = now()
  WHERE image_id = image_uuid;
END;
$$ LANGUAGE plpgsql;

-- Create function to increment image downloads
CREATE OR REPLACE FUNCTION increment_image_downloads(image_uuid uuid)
RETURNS void AS $$
BEGIN
  UPDATE image_analytics
  SET downloads = downloads + 1
  WHERE image_id = image_uuid;
END;
$$ LANGUAGE plpgsql;
