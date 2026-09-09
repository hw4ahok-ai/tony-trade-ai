
create table if not exists public.paper_execution (
 symbol text not null, signal_date date not null,
 action text not null, created_at timestamptz not null default now(),
 primary key(symbol,signal_date)
);
alter table public.paper_execution enable row level security;
revoke all on public.paper_execution from anon,authenticated;
create or replace function public.apply_paper_signal(
 p_symbol text,p_date date,p_signal text,p_close numeric,p_reason text,
 p_market numeric,p_execution_time timestamptz
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $$
declare s public.paper_state%rowtype; v_price numeric; v_qty numeric;
 v_fee numeric; v_gross numeric; v_action text:='HOLD';
begin
 if p_symbol not in ('BTCUSDT','ETHUSDT','SOLUSDT')
 or p_signal not in ('BUY','SELL','HOLD')
 or p_close is null or p_close<=0 or p_market is null or p_market<=0
 or p_date is null or p_reason is null or length(p_reason)>500
 or p_execution_time is null or p_execution_time>now()+interval '1 minute'
 or p_date>(p_execution_time at time zone 'UTC')::date
 then raise exception 'Invalid paper signal'; end if;
 select * into s from public.paper_state where symbol=p_symbol for update;
 if not found then raise exception 'Paper account missing'; end if;
 if exists(select 1 from public.paper_execution where symbol=p_symbol and signal_date=p_date)
 then return jsonb_build_object('status','ALREADY_PROCESSED'); end if;
 if s.last_signal_date is not null and p_date<s.last_signal_date
 then raise exception 'Out-of-order signal'; end if;
 if exists(select 1 from public.daily_signals where symbol=p_symbol and signal_date=p_date)
 then raise exception 'Existing signal requires audit'; end if;
 if p_signal='BUY' and s.position_qty=0 then
  v_price:=p_market*1.0005;
  v_qty:=least(s.cash,(s.cash+s.position_qty*p_market)*0.20)/(v_price*1.001);
  v_gross:=v_qty*v_price;v_fee:=v_gross*0.001;
  if v_qty>0 then
   s.cash:=s.cash-v_gross-v_fee;s.position_qty:=v_qty;s.entry_price:=v_price;v_action:='BUY';
  end if;
 elsif p_signal='SELL' and s.position_qty>0 then
  v_price:=p_market*0.9995;v_qty:=s.position_qty;
  v_gross:=v_qty*v_price;v_fee:=v_gross*0.001;
  s.cash:=s.cash+v_gross-v_fee;s.position_qty:=0;s.entry_price:=null;v_action:='SELL';
 end if;
 insert into public.daily_signals(symbol,signal_date,signal,close_price,reason)
 values(p_symbol,p_date,p_signal,p_close,p_reason);
 if v_action in ('BUY','SELL') then
  insert into public.paper_journal(symbol,side,price,qty,fee,reason,signal_date,created_at)
  values(p_symbol,v_action,v_price,v_qty,v_fee,p_reason,p_date,p_execution_time);
 end if;
 update public.paper_state set cash=s.cash,position_qty=s.position_qty,entry_price=s.entry_price,
 last_price=p_market,last_signal_date=p_date,updated_at=p_execution_time where symbol=p_symbol;
 insert into public.paper_execution(symbol,signal_date,action) values(p_symbol,p_date,v_action);
 return jsonb_build_object('status','DONE','action',v_action,'cash',s.cash,'qty',s.position_qty);
end $$;
revoke all on function public.apply_paper_signal(text,date,text,numeric,text,numeric,timestamptz) from public,anon,authenticated;
grant execute on function public.apply_paper_signal(text,date,text,numeric,text,numeric,timestamptz) to service_role;
