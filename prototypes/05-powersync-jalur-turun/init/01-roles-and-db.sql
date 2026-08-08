-- Dijalankan sekali oleh entrypoint postgres saat volume masih kosong.
--
-- Menirukan `db/bootstrap.js` supaya migrasi 0001-0018 dapat dijalankan apa
-- adanya terhadap container ini: nama role dan nama database harus sama
-- persis dengan yang diharapkan migrasi.

CREATE ROLE lumi_owner WITH LOGIN PASSWORD 'lumi_owner';
CREATE ROLE lumi_app WITH LOGIN PASSWORD 'lumi_app';

CREATE DATABASE lumi OWNER lumi_owner;
