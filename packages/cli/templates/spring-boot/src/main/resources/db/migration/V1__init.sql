-- V1: initial schema
-- Flyway runs this once on first boot; subsequent changes go in V2__, V3__, etc.

-- ── greetings ──────────────────────────────────────────────────────────────
CREATE TABLE greetings (
    id         BIGSERIAL    PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    message    VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── products ───────────────────────────────────────────────────────────────
CREATE TABLE products (
    id         BIGSERIAL      PRIMARY KEY,
    name       VARCHAR(100)   NOT NULL,
    category   VARCHAR(50)    NOT NULL,
    price      NUMERIC(10, 2) NOT NULL,
    in_stock   BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Seed data — gives the UI something to display on first load
INSERT INTO products (name, category, price, in_stock) VALUES
    ('Wireless Headphones',  'Electronics', 79.99,  TRUE),
    ('Ergonomic Chair',      'Furniture',   299.00, TRUE),
    ('Standing Desk',        'Furniture',   549.00, FALSE),
    ('Mechanical Keyboard',  'Electronics', 129.99, TRUE),
    ('USB-C Hub',            'Electronics', 49.99,  TRUE),
    ('Monitor Arm',          'Furniture',   89.00,  TRUE),
    ('HD Webcam',            'Electronics', 69.99,  FALSE),
    ('Desk Lamp',            'Lighting',    39.99,  TRUE),
    ('Noise-Cancel Earbuds', 'Electronics', 149.00, TRUE),
    ('Cable Management Kit', 'Accessories', 19.99,  TRUE);
