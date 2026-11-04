CREATE TABLE IF NOT EXISTS public.mobile_experience_reports (
  event_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_role TEXT NOT NULL CHECK (user_role IN ('rider', 'driver')),
  event_type TEXT NOT NULL CHECK (event_type IN ('error', 'screen_view', 'task_success', 'task_failure', 'feedback')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  screen TEXT,
  action TEXT,
  duration_ms INTEGER,
  error_name TEXT,
  message TEXT,
  stack TEXT,
  feedback TEXT,
  app_version TEXT,
  platform TEXT,
  analysis JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mobile_experience_reports_created_at_idx
  ON public.mobile_experience_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS mobile_experience_reports_type_created_at_idx
  ON public.mobile_experience_reports (event_type, created_at DESC);

ALTER TABLE public.mobile_experience_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mobile_experience_reports FROM anon, authenticated;
GRANT ALL ON TABLE public.mobile_experience_reports TO service_role;

CREATE OR REPLACE FUNCTION public.create_mobile_experience_admin_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  report_source_event_id TEXT;
  notification_title TEXT;
  notification_body TEXT;
  suggestion_lines TEXT;
  report_ids JSONB;
BEGIN
  -- Ignore ordinary telemetry rows. Actionable rows create inbox items after
  -- their AI analysis is attached; the insert case also supports pre-analyzed
  -- inserts from future ingestion paths.
  IF NEW.event_type NOT IN ('error', 'task_failure', 'feedback') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.analysis IS NOT DISTINCT FROM OLD.analysis THEN
    RETURN NEW;
  END IF;
  IF NEW.analysis IS NULL THEN
    RETURN NEW;
  END IF;

  report_source_event_id := 'mobile_experience:' || NEW.event_id;
  report_ids := COALESCE(NEW.analysis->'reportIds', jsonb_build_array(NEW.event_id));
  notification_title := format(
    'Mobile app %s: %s / %s',
    CASE
      WHEN NEW.action = 'user_initiated_health_check' THEN 'health check'
      WHEN NEW.event_type = 'feedback' THEN 'feedback'
      ELSE 'issue'
    END,
    COALESCE(NEW.user_role, 'user'),
    COALESCE(NEW.screen, 'unknown screen')
  );

  SELECT string_agg(format('Suggestion %s: %s', item.ordinality, item.value), E'\n' ORDER BY item.ordinality)
    INTO suggestion_lines
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(NEW.analysis->'suggestions') = 'array' THEN NEW.analysis->'suggestions'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS item(value, ordinality);

  notification_body := concat_ws(E'\n',
    NULLIF(NEW.analysis->>'summary', ''),
    CASE WHEN NULLIF(NEW.analysis->>'likelyCause', '') IS NOT NULL
      THEN 'Likely cause: ' || (NEW.analysis->>'likelyCause') END,
    suggestion_lines,
    CASE WHEN NEW.event_type = 'error' AND NULLIF(NEW.message, '') IS NOT NULL
      THEN 'Error: ' || NEW.message END,
    CASE WHEN NEW.event_type = 'feedback' AND NULLIF(NEW.feedback, '') IS NOT NULL
      THEN 'User feedback: ' || NEW.feedback END
  );

  -- Prevent duplicate inbox rows if the report is retried or re-analyzed.
  IF EXISTS (
    SELECT 1
    FROM public.admin_notifications n
    WHERE n.type = 'mobile_experience_alert'
      AND n.metadata @> jsonb_build_object('sourceEventId', report_source_event_id)
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.admin_notifications (
    recipient_user_id,
    title,
    body,
    type,
    action_url,
    metadata
  )
  SELECT
    a.user_id,
    notification_title,
    COALESCE(NULLIF(notification_body, ''), 'A mobile app experience report needs review.'),
    'mobile_experience_alert',
    '/admin/mobile-experience',
    jsonb_build_object(
      'source', 'mobile_app',
      'sourceEventId', report_source_event_id,
      'reportIds', report_ids,
      'userRole', NEW.user_role,
      'screen', NEW.screen,
      'appVersion', NEW.app_version,
      'platform', NEW.platform,
      'analysis', NEW.analysis,
      'details', jsonb_build_object(
        'type', NEW.event_type,
        'action', NEW.action,
        'occurredAt', NEW.occurred_at,
        'errorName', NEW.error_name,
        'message', NEW.message,
        'stack', NEW.stack,
        'feedback', NEW.feedback
      )
    )
  FROM public.admins a
  JOIN public.users u ON u.id = a.user_id
  WHERE COALESCE(u.status, 'active') = 'active';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mobile_experience_admin_notifications ON public.mobile_experience_reports;
CREATE TRIGGER trg_mobile_experience_admin_notifications
AFTER INSERT OR UPDATE ON public.mobile_experience_reports
FOR EACH ROW
EXECUTE FUNCTION public.create_mobile_experience_admin_notifications();
