-- Before the jsonb column type in packages/db/src/columns.ts, bun run ingest stored claude_session.costs and claude_entry.raw as one JSON string each, holding the object's text. This turns every such row back into the object. Run it once with psql, outside a transaction (each batch commits on its own), on the dashboard's Postgres after the importer runs the fixed code; a re-run changes nothing.
-- psql -v ON_ERROR_STOP=1 -f packages/db/repairs/jsonb-strings.sql "$POSTGRES_URL"

update claude_session set costs = (costs #>> '{}')::jsonb where jsonb_typeof(costs) = 'string';

do $$
declare
  batch constant int := 10000;
  from_session text := '';
  from_uuid text := '';
  to_session text;
  to_uuid text;
  fixed int;
  total bigint := 0;
begin
  loop
    select session_id, uuid into to_session, to_uuid
    from (
      select session_id, uuid from claude_entry
      where (session_id, uuid) > (from_session, from_uuid)
      order by session_id, uuid
      limit batch
    ) keys
    order by session_id desc, uuid desc
    limit 1;
    exit when not found;
    update claude_entry set raw = (raw #>> '{}')::jsonb
    where (session_id, uuid) > (from_session, from_uuid)
      and (session_id, uuid) <= (to_session, to_uuid)
      and jsonb_typeof(raw) = 'string';
    get diagnostics fixed = row_count;
    total := total + fixed;
    commit;
    raise notice 'claude_entry: % fixed through (%, %), % in all', fixed, to_session, to_uuid, total;
    from_session := to_session;
    from_uuid := to_uuid;
  end loop;
end $$;

select
  (select count(*) from claude_session where jsonb_typeof(costs) = 'string') as costs_strings,
  (select count(*) from claude_entry where jsonb_typeof(raw) = 'string') as raw_strings;
