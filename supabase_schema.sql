-- Supabase Database Schema for NeuroTrace Clinical AI
-- Run this script in your Supabase SQL Editor

-- 1. Profiles Table (Extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role TEXT CHECK (role IN ('admin', 'doctor', 'patient')) DEFAULT 'patient',
  full_name TEXT,
  age INTEGER,
  gender TEXT,
  contact_number TEXT,
  address TEXT,
  neurological_condition BOOLEAN,
  family_history BOOLEAN,
  blood_type TEXT,
  allergies TEXT,
  current_medications TEXT,
  primary_care_physician TEXT,
  emergency_contact_name TEXT,
  emergency_contact_number TEXT,
  handedness TEXT,
  symptom_onset_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 2. Doctor-Patient Relations (QR Code Connection)
CREATE TABLE IF NOT EXISTS doctor_patient_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('active', 'pending')) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  UNIQUE(doctor_id, patient_id)
);

-- 3. Predictions and Reports
CREATE TABLE IF NOT EXISTS predictions_and_reports (
  report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  image_url TEXT,
  prediction_result TEXT,
  severity_level TEXT CHECK (severity_level IN ('Higher Level', 'Lower Level', 'None')),
  confidence_score NUMERIC,
  doctor_suggestions TEXT,
  analysis_date TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 4. Messages (Real-time Chat)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 5. Appointments
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  appointment_date TIMESTAMP WITH TIME ZONE,
  status TEXT CHECK (status IN ('scheduled', 'completed', 'cancelled')) DEFAULT 'scheduled',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Enable Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_patient_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions_and_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- Create Policies (For prototype, allowing all authenticated users to read/write. In production, restrict based on auth.uid())
CREATE POLICY "Allow authed users full access to profiles" ON profiles FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authed users full access to relations" ON doctor_patient_relations FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authed users full access to reports" ON predictions_and_reports FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authed users full access to messages" ON messages FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authed users full access to appointments" ON appointments FOR ALL USING (auth.role() = 'authenticated');

-- Automatic Profile Creation Trigger on Auth Signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    new.id, 
    COALESCE(new.raw_user_meta_data->>'role', 'patient'),
    COALESCE(new.raw_user_meta_data->>'full_name', '')
  );
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
