-- Cơ sở dữ liệu cho trang Quanlymanglan bản GitHub (chạy MỘT LẦN trong Supabase > SQL Editor > Run).
-- Trang web nằm trên GitHub Pages; tài khoản đăng nhập bằng GitHub; quyền lưu ở đây.
-- Quản trị viên: tài khoản GitHub ghi ở dòng "admin_github" bên dưới (sửa nếu muốn người khác làm quản trị).

-- Cài đặt chung (một dòng duy nhất)
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  title text not null default 'Kết nối máy chủ LAN',
  admin_github text not null default 'm23931716-coder',
  auto_approve text not null default 'off' check (auto_approve in ('off', 'all')),
  servers jsonb not null default '[]'          -- [{ "name": "...", "url": "https://..." }] do quản trị viên nhập
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Hồ sơ người dùng: tự tạo khi đăng nhập GitHub lần đầu
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  github text,
  name text,
  avatar text,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  created_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  last_seen timestamptz
);

-- Tạo hồ sơ khi có người đăng nhập lần đầu. Đúng tài khoản GitHub quản trị thì thành quản trị viên ngay;
-- người khác chờ cấp quyền (hoặc được cấp ngay nếu bật tự động cấp quyền).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.settings;
  gh text := lower(coalesce(new.raw_user_meta_data->>'user_name', new.raw_user_meta_data->>'preferred_username', ''));
  is_owner boolean;
begin
  select * into s from public.settings where id = 1;
  is_owner := gh <> '' and gh = lower(s.admin_github);
  insert into public.profiles (id, github, name, avatar, role, status, approved_by, approved_at)
  values (
    new.id, gh,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', gh, new.email),
    new.raw_user_meta_data->>'avatar_url',
    case when is_owner then 'admin' else 'user' end,
    case when is_owner or s.auto_approve = 'all' then 'approved' else 'pending' end,
    case when is_owner then 'Chủ hệ thống' when s.auto_approve = 'all' then 'Tự động cấp quyền' end,
    case when is_owner or s.auto_approve = 'all' then now() end
  ) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'approved');
$$;

create or replace function public.is_approved() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;

-- Người dùng tự ghi "lần cuối truy cập" của chính mình (không sửa được quyền, trạng thái)
create or replace function public.touch() returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_seen = now() where id = auth.uid();
$$;

-- Bảo mật theo dòng: ai cũng chỉ thấy hồ sơ của mình; quản trị viên thấy và sửa được tất cả
alter table public.profiles enable row level security;
alter table public.settings enable row level security;

drop policy if exists "xem ho so" on public.profiles;
create policy "xem ho so" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "quan tri sua" on public.profiles;
create policy "quan tri sua" on public.profiles for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "quan tri xoa" on public.profiles;
create policy "quan tri xoa" on public.profiles for delete using (public.is_admin());

-- Cài đặt (có địa chỉ máy chủ): chỉ người đã được cấp quyền mới đọc được; chỉ quản trị viên sửa được
drop policy if exists "da cap quyen xem" on public.settings;
create policy "da cap quyen xem" on public.settings for select using (public.is_approved());
drop policy if exists "quan tri sua cai dat" on public.settings;
create policy "quan tri sua cai dat" on public.settings for update using (public.is_admin()) with check (public.is_admin());

grant execute on function public.touch() to authenticated;
