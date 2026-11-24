begin;

alter table private.confirmed_order_items add column note text
  check (note is null or (char_length(note) between 1 and 160 and note !~ '[[:cntrl:]]'));

do $migration$
declare definition text := pg_get_functiondef('private.create_manual_order(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure);
begin
  if strpos(definition, $anchor$(item - array['lineId','productId','quantity','variantId']::text[])$anchor$) = 0 then
    raise exception 'Unexpected definition of private.create_manual_order';
  end if;
  definition := replace(definition, $anchor$(item - array['lineId','productId','quantity','variantId']::text[])$anchor$, $replacement$(item - array['lineId','productId','quantity','variantId','note']::text[])$replacement$);
  if strpos(definition, $anchor$        or (item ->> 'lineId') !~* uuid_pattern$anchor$) = 0 then
    raise exception 'Unexpected definition of private.create_manual_order';
  end if;
  definition := replace(definition, $anchor$        or (item ->> 'lineId') !~* uuid_pattern$anchor$, $replacement$        or (item ? 'note' and (jsonb_typeof(item->'note') <> 'string'
          or char_length(btrim(item->>'note')) not between 1 and 160
          or item->>'note' ~ '[[:cntrl:]]'))
        or (item ->> 'lineId') !~* uuid_pattern$replacement$);
  if strpos(definition, $anchor$  outcome := private.append_confirmed_order($anchor$) = 0 then
    raise exception 'Unexpected definition of private.create_manual_order';
  end if;
  definition := replace(definition, $anchor$  outcome := private.append_confirmed_order($anchor$, $replacement$  quote := jsonb_set(quote, '{lines}', (
    select jsonb_agg(line.value || case when item ? 'note'
      then jsonb_build_object('note', btrim(item->>'note')) else '{}'::jsonb end
      order by line.ordinality)
    from jsonb_array_elements(quote->'lines') with ordinality line
    join jsonb_array_elements(target_items) item on item->>'lineId' = line.value->>'lineId'
  ));
  outcome := private.append_confirmed_order($replacement$);
  execute definition;
end
$migration$;

do $migration$
declare definition text := pg_get_functiondef('private.append_confirmed_order(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure);
begin
  if strpos(definition, $anchor$    total_cents
  )
  select target_tenant_id$anchor$) = 0 then
    raise exception 'Unexpected definition of private.append_confirmed_order';
  end if;
  definition := replace(definition, $anchor$    total_cents
  )
  select target_tenant_id$anchor$, $replacement$    total_cents, note
  )
  select target_tenant_id$replacement$);
  if strpos(definition, $anchor$    (line.value ->> 'totalCents')::integer
  from jsonb_array_elements$anchor$) = 0 then
    raise exception 'Unexpected definition of private.append_confirmed_order';
  end if;
  definition := replace(definition, $anchor$    (line.value ->> 'totalCents')::integer
  from jsonb_array_elements$anchor$, $replacement$    (line.value ->> 'totalCents')::integer, line.value ->> 'note'
  from jsonb_array_elements$replacement$);
  execute definition;
end
$migration$;

do $migration$
declare definition text := pg_get_functiondef('private.production_board(uuid,uuid,uuid)'::regprocedure);
begin
  if strpos(definition, $anchor$line.position, line.title, line.variant_title, line.quantity$anchor$) = 0 then
    raise exception 'Unexpected definition of private.production_board';
  end if;
  definition := replace(definition, $anchor$line.position, line.title, line.variant_title, line.quantity$anchor$, $replacement$line.position, line.title, line.variant_title, line.quantity, line.note$replacement$);
  if strpos(definition, $anchor$      ) order by mine.position, mine.line_id) as items$anchor$) = 0 then
    raise exception 'Unexpected definition of private.production_board';
  end if;
  definition := replace(definition, $anchor$      ) order by mine.position, mine.line_id) as items$anchor$, $replacement$      ) || case when mine.note is null then '{}'::jsonb
        else jsonb_build_object('note', mine.note) end
      order by mine.position, mine.line_id) as items$replacement$);
  execute definition;
end
$migration$;

commit;
