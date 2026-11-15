create table users (
  id integer primary key autoincrement,
  email text unique not null,
  password text not null,
  is_admin integer default 0
);

create table notes (
  id integer primary key autoincrement,
  user_id integer not null references users(id),
  title text not null,
  body text,
  link text
);
