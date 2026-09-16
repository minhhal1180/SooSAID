-- S.O.S Aid reference schema for PostgreSQL + PostGIS
-- Run only after review in your environment.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE user_role AS ENUM ('CITIZEN','OPERATOR_115','CLINICIAN','AMBULANCE_CREW','FACILITY_USER','LOCAL_RESPONDER','ADMIN','AUDITOR');
CREATE TYPE case_status AS ENUM ('CREATED','QUEUED','ACCEPTED','VIDEO_CONNECTED','DISPATCHED','EN_ROUTE','ON_SCENE','HANDOVER_PENDING','HANDED_OVER','CLOSED','CANCELLED','FALSE_ALARM');
CREATE TYPE assignment_type AS ENUM ('AMBULANCE_UNIT','LOCAL_RESPONDER');
CREATE TYPE assignment_status AS ENUM ('PENDING','ACCEPTED','REJECTED','EN_ROUTE','ARRIVED','COMPLETED','CANCELLED');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone varchar(32) UNIQUE,
  email varchar(255),
  full_name varchar(255),
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  locale varchar(16) NOT NULL DEFAULT 'vi-VN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  organization_id uuid,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  platform varchar(16) NOT NULL CHECK (platform IN ('ios','android','web')),
  push_token text,
  app_version varchar(32),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE emergency_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  blood_type varchar(8),
  allergies jsonb NOT NULL DEFAULT '[]'::jsonb,
  chronic_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  medications jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferred_facility text,
  special_note text,
  consent_share_in_emergency boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE emergency_contacts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  phone varchar(32) NOT NULL,
  relation varchar(64),
  priority smallint NOT NULL DEFAULT 1,
  notify_by_push boolean NOT NULL DEFAULT true,
  notify_by_sms boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_areas (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code varchar(64) UNIQUE NOT NULL,
  name varchar(255) NOT NULL,
  geom geometry(MultiPolygon,4326),
  active boolean NOT NULL DEFAULT true,
  routing_priority integer NOT NULL DEFAULT 100
);
CREATE INDEX idx_service_areas_geom ON service_areas USING GIST (geom);

CREATE TABLE medical_facilities (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code varchar(64) UNIQUE,
  name varchar(255) NOT NULL,
  facility_type varchar(64) NOT NULL,
  phone varchar(32),
  address text,
  location geography(Point,4326) NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  service_area_id uuid REFERENCES service_areas(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_medical_facilities_location ON medical_facilities USING GIST (location);

CREATE TABLE local_resources (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  resource_type varchar(64) NOT NULL,
  name varchar(255) NOT NULL,
  location geography(Point,4326) NOT NULL,
  address text,
  access_instruction text,
  organization_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_local_resources_location ON local_resources USING GIST (location);

CREATE TABLE ambulance_units (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code varchar(64) UNIQUE NOT NULL,
  display_name varchar(255) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'OFFLINE',
  current_location geography(Point,4326),
  service_area_id uuid REFERENCES service_areas(id),
  last_location_at timestamptz,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_ambulance_units_location ON ambulance_units USING GIST (current_location);

CREATE TABLE responders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid,
  certification_status varchar(32) NOT NULL DEFAULT 'PENDING',
  available boolean NOT NULL DEFAULT false,
  current_location geography(Point,4326),
  last_location_at timestamptz,
  skills jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX idx_responders_location ON responders USING GIST (current_location);

CREATE TABLE emergency_cases (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code varchar(64) UNIQUE NOT NULL,
  trigger_source varchar(32) NOT NULL DEFAULT 'sos_button',
  caller_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  service_area_id uuid REFERENCES service_areas(id),
  active_operator_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status case_status NOT NULL DEFAULT 'CREATED',
  number_of_patients integer NOT NULL DEFAULT 1 CHECK (number_of_patients > 0),
  first_location geography(Point,4326),
  latest_location geography(Point,4326),
  latest_accuracy_meters numeric(8,2),
  address_text text,
  access_note text,
  media_consent boolean NOT NULL DEFAULT false,
  emergency_profile_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cases_status_created ON emergency_cases(status, created_at DESC);
CREATE INDEX idx_cases_latest_location ON emergency_cases USING GIST (latest_location);

CREATE TABLE case_locations (
  id bigserial PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES emergency_cases(id) ON DELETE CASCADE,
  location geography(Point,4326) NOT NULL,
  accuracy_meters numeric(8,2),
  altitude_meters numeric(10,2),
  address_text text,
  access_note text,
  source varchar(32) NOT NULL DEFAULT 'mobile_gps',
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_case_locations_case_time ON case_locations(case_id, captured_at DESC);
CREATE INDEX idx_case_locations_geo ON case_locations USING GIST (location);

CREATE TABLE triage_submissions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id uuid NOT NULL REFERENCES emergency_cases(id) ON DELETE CASCADE,
  questionnaire_version varchar(64) NOT NULL,
  answers jsonb NOT NULL,
  submitted_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_status_history (
  id bigserial PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES emergency_cases(id) ON DELETE CASCADE,
  from_status case_status,
  to_status case_status NOT NULL,
  reason text,
  changed_by uuid REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_case_status_history_case ON case_status_history(case_id, changed_at);

CREATE TABLE video_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id uuid NOT NULL REFERENCES emergency_cases(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL,
  provider_room_id varchar(255) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'CREATED',
  recording_enabled boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  ended_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id uuid REFERENCES emergency_cases(id) ON DELETE CASCADE,
  video_session_id uuid REFERENCES video_sessions(id) ON DELETE SET NULL,
  media_type varchar(32) NOT NULL,
  storage_key text NOT NULL,
  mime_type varchar(128),
  size_bytes bigint,
  checksum_sha256 varchar(64),
  encryption_key_ref text,
  retention_class varchar(64) NOT NULL DEFAULT 'case_media_default',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE dispatch_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id uuid NOT NULL REFERENCES emergency_cases(id) ON DELETE CASCADE,
  assignment_type assignment_type NOT NULL,
  ambulance_unit_id uuid REFERENCES ambulance_units(id),
  responder_id uuid REFERENCES responders(id),
  status assignment_status NOT NULL DEFAULT 'PENDING',
  priority varchar(16) NOT NULL DEFAULT 'normal',
  assigned_by uuid REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  CHECK (
    (assignment_type='AMBULANCE_UNIT' AND ambulance_unit_id IS NOT NULL AND responder_id IS NULL)
    OR (assignment_type='LOCAL_RESPONDER' AND responder_id IS NOT NULL AND ambulance_unit_id IS NULL)
  )
);
CREATE INDEX idx_dispatch_case ON dispatch_assignments(case_id, assigned_at DESC);

CREATE TABLE guidance_catalog (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code varchar(64) NOT NULL,
  version integer NOT NULL,
  title varchar(255) NOT NULL,
  content jsonb NOT NULL,
  approval_status varchar(32) NOT NULL DEFAULT 'DRAFT',
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  effective_from timestamptz,
  retired_at timestamptz,
  UNIQUE(code, version)
);

CREATE TABLE guidance_events (
  id bigserial PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES emergency_cases(id) ON DELETE CASCADE,
  guidance_id uuid REFERENCES guidance_catalog(id),
  action varchar(32) NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE case_notes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id uuid NOT NULL REFERENCES emergency_cases(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES users(id),
  note_type varchar(64) NOT NULL DEFAULT 'general',
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE handovers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id uuid NOT NULL REFERENCES emergency_cases(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  receiving_facility_id uuid REFERENCES medical_facilities(id),
  ambulance_unit_id uuid REFERENCES ambulance_units(id),
  payload jsonb NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'DRAFT',
  finalized_by uuid REFERENCES users(id),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id, version)
);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id uuid REFERENCES emergency_cases(id) ON DELETE CASCADE,
  channel varchar(32) NOT NULL,
  recipient text NOT NULL,
  template_code varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'PENDING',
  provider_message_id text,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE consent_records (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  case_id uuid REFERENCES emergency_cases(id) ON DELETE SET NULL,
  consent_type varchar(64) NOT NULL,
  policy_version varchar(64) NOT NULL,
  granted boolean NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(128) NOT NULL,
  resource_type varchar(64) NOT NULL,
  resource_id text,
  case_id uuid REFERENCES emergency_cases(id) ON DELETE SET NULL,
  ip_address inet,
  user_agent text,
  result varchar(32) NOT NULL DEFAULT 'SUCCESS',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_case_time ON audit_logs(case_id, created_at DESC);
CREATE INDEX idx_audit_actor_time ON audit_logs(actor_user_id, created_at DESC);

CREATE TABLE idempotency_keys (
  key varchar(128) PRIMARY KEY,
  user_id uuid,
  endpoint varchar(255) NOT NULL,
  request_hash varchar(64) NOT NULL,
  response_code integer,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  aggregate_type varchar(64) NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type varchar(128) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_outbox_unpublished ON outbox_events(created_at) WHERE published_at IS NULL;
