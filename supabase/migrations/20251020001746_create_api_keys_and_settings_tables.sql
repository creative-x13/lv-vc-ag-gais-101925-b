/*
  # API Keys and User Settings Schema

  ## Overview
  This migration creates the foundational tables for managing API keys, user settings, 
  and configuration data for the multi-modal AI agent application.

  ## New Tables

  ### 1. `user_profiles`
  Stores user profile information and preferences.
  - `id` (uuid, primary key) - Links to auth.users
  - `email` (text) - User's email address
  - `full_name` (text) - User's full name
  - `company_name` (text) - Business/company name
  - `created_at` (timestamptz) - Account creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 2. `api_keys`
  Securely stores API keys for various services (Gemini, etc).
  - `id` (uuid, primary key)
  - `user_id` (uuid, foreign key to user_profiles)
  - `service_name` (text) - Name of the service (e.g., 'gemini', 'openai')
  - `encrypted_key` (text) - Encrypted API key value
  - `is_active` (boolean) - Whether this key is currently active
  - `last_used_at` (timestamptz) - Last time the key was used
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 3. `widget_settings`
  Stores configuration settings for each AI widget instance.
  - `id` (uuid, primary key)
  - `user_id` (uuid, foreign key to user_profiles)
  - `widget_type` (text) - Type of widget (e.g., 'live-audio', 'remodel', 'landscaping')
  - `agent_name` (text) - Custom agent name
  - `system_instruction` (text) - Custom system instruction/prompt
  - `voice_config` (jsonb) - Voice configuration settings
  - `appearance_config` (jsonb) - Visual customization settings
  - `is_active` (boolean) - Whether this widget configuration is active
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## Security
  - Row Level Security (RLS) is enabled on all tables
  - Users can only access their own data
  - API keys are encrypted and only accessible to the owning user
*/

-- Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  full_name text,
  company_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create api_keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  service_name text NOT NULL,
  encrypted_key text NOT NULL,
  is_active boolean DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, service_name)
);

-- Create widget_settings table
CREATE TABLE IF NOT EXISTS widget_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  widget_type text NOT NULL,
  agent_name text DEFAULT 'Virtual Assistant',
  system_instruction text,
  voice_config jsonb DEFAULT '{}'::jsonb,
  appearance_config jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE widget_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_profiles
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- RLS Policies for api_keys
CREATE POLICY "Users can view own API keys"
  ON api_keys FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own API keys"
  ON api_keys FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own API keys"
  ON api_keys FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own API keys"
  ON api_keys FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for widget_settings
CREATE POLICY "Users can view own widget settings"
  ON widget_settings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own widget settings"
  ON widget_settings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own widget settings"
  ON widget_settings FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own widget settings"
  ON widget_settings FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_service_name ON api_keys(service_name);
CREATE INDEX IF NOT EXISTS idx_widget_settings_user_id ON widget_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_widget_settings_widget_type ON widget_settings(widget_type);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_api_keys_updated_at
  BEFORE UPDATE ON api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_widget_settings_updated_at
  BEFORE UPDATE ON widget_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
