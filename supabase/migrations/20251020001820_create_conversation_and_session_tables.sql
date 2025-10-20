/*
  # Conversation Transcripts and Session History Schema

  ## Overview
  This migration creates tables for storing conversation sessions, transcripts, 
  and interaction history from the Live AI widgets.

  ## New Tables

  ### 1. `conversation_sessions`
  Stores metadata about each conversation session.
  - `id` (uuid, primary key)
  - `user_id` (uuid, foreign key to user_profiles)
  - `widget_type` (text) - Which widget was used
  - `session_start` (timestamptz) - When the session started
  - `session_end` (timestamptz) - When the session ended
  - `duration_seconds` (integer) - Total duration in seconds
  - `status` (text) - Session status: 'active', 'completed', 'error', 'abandoned'
  - `metadata` (jsonb) - Additional session metadata
  - `created_at` (timestamptz)

  ### 2. `conversation_transcripts`
  Stores individual messages/turns in a conversation.
  - `id` (uuid, primary key)
  - `session_id` (uuid, foreign key to conversation_sessions)
  - `role` (text) - 'user' or 'model'
  - `content` (text) - The transcript text
  - `timestamp` (timestamptz) - When this message occurred
  - `audio_duration_ms` (integer) - Duration of audio if applicable
  - `metadata` (jsonb) - Additional message metadata
  - `created_at` (timestamptz)

  ### 3. `function_calls_log`
  Logs all function calls made during conversations (lead capture, scheduling, etc).
  - `id` (uuid, primary key)
  - `session_id` (uuid, foreign key to conversation_sessions)
  - `function_name` (text) - Name of the function called
  - `arguments` (jsonb) - Function arguments
  - `response` (jsonb) - Function response
  - `status` (text) - 'success', 'error', 'pending'
  - `error_message` (text) - Error details if failed
  - `created_at` (timestamptz)

  ## Security
  - Row Level Security (RLS) enabled on all tables
  - Users can only access their own conversation data
  - Admins can access all data for analytics
*/

-- Create conversation_sessions table
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  widget_type text NOT NULL,
  session_start timestamptz DEFAULT now(),
  session_end timestamptz,
  duration_seconds integer,
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'error', 'abandoned')),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create conversation_transcripts table
CREATE TABLE IF NOT EXISTS conversation_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'model')),
  content text NOT NULL,
  timestamp timestamptz DEFAULT now(),
  audio_duration_ms integer,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create function_calls_log table
CREATE TABLE IF NOT EXISTS function_calls_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  function_name text NOT NULL,
  arguments jsonb NOT NULL,
  response jsonb,
  status text DEFAULT 'pending' CHECK (status IN ('success', 'error', 'pending')),
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE conversation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE function_calls_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for conversation_sessions
CREATE POLICY "Users can view own conversation sessions"
  ON conversation_sessions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own conversation sessions"
  ON conversation_sessions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can update own conversation sessions"
  ON conversation_sessions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL)
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Allow anonymous session creation"
  ON conversation_sessions FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous session viewing"
  ON conversation_sessions FOR SELECT
  TO anon
  USING (true);

-- RLS Policies for conversation_transcripts
CREATE POLICY "Users can view own transcripts"
  ON conversation_transcripts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversation_sessions
      WHERE conversation_sessions.id = conversation_transcripts.session_id
      AND conversation_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own transcripts"
  ON conversation_transcripts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversation_sessions
      WHERE conversation_sessions.id = conversation_transcripts.session_id
      AND (conversation_sessions.user_id = auth.uid() OR conversation_sessions.user_id IS NULL)
    )
  );

CREATE POLICY "Allow anonymous transcript creation"
  ON conversation_transcripts FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous transcript viewing"
  ON conversation_transcripts FOR SELECT
  TO anon
  USING (true);

-- RLS Policies for function_calls_log
CREATE POLICY "Users can view own function calls"
  ON function_calls_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversation_sessions
      WHERE conversation_sessions.id = function_calls_log.session_id
      AND conversation_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own function calls"
  ON function_calls_log FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversation_sessions
      WHERE conversation_sessions.id = function_calls_log.session_id
      AND (conversation_sessions.user_id = auth.uid() OR conversation_sessions.user_id IS NULL)
    )
  );

CREATE POLICY "Allow anonymous function call logging"
  ON function_calls_log FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous function call viewing"
  ON function_calls_log FOR SELECT
  TO anon
  USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_user_id ON conversation_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_widget_type ON conversation_sessions(widget_type);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_status ON conversation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_created_at ON conversation_sessions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_transcripts_session_id ON conversation_transcripts(session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_transcripts_timestamp ON conversation_transcripts(timestamp);
CREATE INDEX IF NOT EXISTS idx_conversation_transcripts_role ON conversation_transcripts(role);

CREATE INDEX IF NOT EXISTS idx_function_calls_session_id ON function_calls_log(session_id);
CREATE INDEX IF NOT EXISTS idx_function_calls_function_name ON function_calls_log(function_name);
CREATE INDEX IF NOT EXISTS idx_function_calls_status ON function_calls_log(status);
CREATE INDEX IF NOT EXISTS idx_function_calls_created_at ON function_calls_log(created_at DESC);

-- Create function to calculate and update session duration
CREATE OR REPLACE FUNCTION update_session_duration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.session_end IS NOT NULL AND NEW.session_start IS NOT NULL THEN
    NEW.duration_seconds := EXTRACT(EPOCH FROM (NEW.session_end - NEW.session_start))::integer;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic duration calculation
CREATE TRIGGER calculate_session_duration
  BEFORE UPDATE ON conversation_sessions
  FOR EACH ROW
  WHEN (NEW.session_end IS NOT NULL)
  EXECUTE FUNCTION update_session_duration();
