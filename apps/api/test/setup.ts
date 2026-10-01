// Tests never read the developer's .env: everything they need is passed explicitly.
process.env.NODE_ENV = 'test';
process.env.TZ = 'UTC';
