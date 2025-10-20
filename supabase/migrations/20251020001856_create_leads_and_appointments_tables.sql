/*
  # Lead Capture and Appointment Scheduling Schema

  ## Overview
  This migration creates tables for storing captured leads and scheduled appointments
  from the AI agent interactions. These tables support the core business functions
  of the application.

  ## New Tables

  ### 1. `leads`
  Stores all captured leads from conversations.
  - `id` (uuid, primary key)
  - `session_id` (uuid, foreign key to conversation_sessions)
  - `user_id` (uuid, foreign key to user_profiles) - The business owner
  - `customer_name` (text) - Lead's full name
  - `customer_email` (text) - Lead's email address
  - `customer_phone` (text) - Lead's phone number (optional)
  - `source_widget` (text) - Which widget captured this lead
  - `lead_status` (text) - 'new', 'contacted', 'qualified', 'converted', 'lost'
  - `notes` (text) - Additional notes or context
  - `metadata` (jsonb) - Additional lead data
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 2. `appointments`
  Stores scheduled appointments from conversations.
  - `id` (uuid, primary key)
  - `session_id` (uuid, foreign key to conversation_sessions)
  - `user_id` (uuid, foreign key to user_profiles) - The business owner
  - `lead_id` (uuid, foreign key to leads) - Associated lead if applicable
  - `customer_name` (text)
  - `customer_email` (text)
  - `customer_phone` (text)
  - `appointment_date` (date) - Date of appointment
  - `appointment_time` (time) - Time of appointment
  - `appointment_datetime` (timestamptz) - Combined datetime for querying
  - `service_type` (text) - Type of service requested
  - `status` (text) - 'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'
  - `notes` (text) - Additional appointment notes
  - `metadata` (jsonb) - Additional appointment data
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 3. `lead_interactions`
  Tracks all interactions/touchpoints with a lead.
  - `id` (uuid, primary key)
  - `lead_id` (uuid, foreign key to leads)
  - `interaction_type` (text) - 'call', 'email', 'meeting', 'follow_up', 'note'
  - `interaction_date` (timestamptz)
  - `description` (text)
  - `outcome` (text)
  - `created_by` (uuid, foreign key to user_profiles)
  - `created_at` (timestamptz)

  ## Security
  - Row Level Security (RLS) enabled on all tables
  - Business owners can only access their own leads and appointments
  - Anonymous users can create leads/appointments (for widget embedding)
*/

-- Create leads table
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES conversation_sessions(id) ON DELETE SET NULL,
  user_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text,
  source_widget text,
  lead_status text DEFAULT 'new' CHECK (lead_status IN ('new', 'contacted', 'qualified', 'converted', 'lost')),
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create appointments table
CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES conversation_sessions(id) ON DELETE SET NULL,
  user_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text,
  appointment_date date NOT NULL,
  appointment_time time NOT NULL,
  appointment_datetime timestamptz NOT NULL,
  service_type text,
  status text DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create lead_interactions table
CREATE TABLE IF NOT EXISTS lead_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  interaction_type text NOT NULL CHECK (interaction_type IN ('call', 'email', 'meeting', 'follow_up', 'note', 'conversation')),
  interaction_date timestamptz DEFAULT now(),
  description text NOT NULL,
  outcome text,
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_interactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for leads
CREATE POLICY "Business owners can view own leads"
  ON leads FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Business owners can insert own leads"
  ON leads FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Business owners can update own leads"
  ON leads FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Business owners can delete own leads"
  ON leads FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Allow anonymous lead creation"
  ON leads FOR INSERT
  TO anon
  WITH CHECK (true);

-- RLS Policies for appointments
CREATE POLICY "Business owners can view own appointments"
  ON appointments FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Business owners can insert own appointments"
  ON appointments FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Business owners can update own appointments"
  ON appointments FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Business owners can delete own appointments"
  ON appointments FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Allow anonymous appointment creation"
  ON appointments FOR INSERT
  TO anon
  WITH CHECK (true);

-- RLS Policies for lead_interactions
CREATE POLICY "Users can view interactions for own leads"
  ON lead_interactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leads
      WHERE leads.id = lead_interactions.lead_id
      AND leads.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert interactions for own leads"
  ON lead_interactions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leads
      WHERE leads.id = lead_interactions.lead_id
      AND leads.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own interactions"
  ON lead_interactions FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can delete own interactions"
  ON lead_interactions FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_session_id ON leads(session_id);
CREATE INDEX IF NOT EXISTS idx_leads_customer_email ON leads(customer_email);
CREATE INDEX IF NOT EXISTS idx_leads_lead_status ON leads(lead_status);
CREATE INDEX IF NOT EXISTS idx_leads_source_widget ON leads(source_widget);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_user_id ON appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_session_id ON appointments(session_id);
CREATE INDEX IF NOT EXISTS idx_appointments_lead_id ON appointments(lead_id);
CREATE INDEX IF NOT EXISTS idx_appointments_customer_email ON appointments(customer_email);
CREATE INDEX IF NOT EXISTS idx_appointments_appointment_datetime ON appointments(appointment_datetime);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_created_at ON appointments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_interactions_lead_id ON lead_interactions(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_interactions_interaction_type ON lead_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_lead_interactions_interaction_date ON lead_interactions(interaction_date DESC);

-- Create triggers for updated_at
CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create function to automatically create lead interaction when lead is created
CREATE OR REPLACE FUNCTION create_initial_lead_interaction()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO lead_interactions (
    lead_id,
    interaction_type,
    description,
    created_by
  ) VALUES (
    NEW.id,
    'conversation',
    'Lead captured via ' || COALESCE(NEW.source_widget, 'AI widget'),
    NEW.user_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic lead interaction logging
CREATE TRIGGER log_initial_lead_interaction
  AFTER INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION create_initial_lead_interaction();
