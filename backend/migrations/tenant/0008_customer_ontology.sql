-- 0008_customer_ontology.sql
-- ---------------------------------------------------------------------------
-- Make the entity + relationship vocabulary customer-defined instead of
-- hardcoded in the agents. Until now "person | company | project" lived in the
-- IdentifierAgent prompt and "works_at | key_contact_at | leads | has_client"
-- lived in a frozenset in graph_sync.py. This migration lifts both into the
-- tenant's own brain DB so each customer can define their ontology at
-- onboarding, and the agents read it (the descriptions guide detection).
--
-- Four tables:
--   entity_types          — the kinds of thing this tenant tracks, each with a
--                           one-line description the IdentifierAgent uses, and
--                           the on-disk folder its brain pages live in.
--   entity_type_fields    — the structured attributes each type carries; the
--                           generic AttributeAgent extracts exactly these,
--                           guided by each field's description. Values still
--                           live in the page JSON (the page is source of truth);
--                           this is the *spec*, not the values.
--   relationship_types    — the predicates, each with a description the
--                           RelationshipAgent picks from (closed set, never
--                           invented) and an optional subject_type/object_type
--                           domain-range guardrail.
--   question_entities     — read-side provenance: which entities the brain
--                           surfaced for a given question (vector hit vs graph
--                           neighbour), mirroring the comprehension_* links.
--
-- Everything is seeded with today's hardcoded ontology FIRST, then entities.type
-- and relationships.predicate are foreign-keyed onto it, so existing brain data
-- and the demo keep working unchanged.
-- ---------------------------------------------------------------------------

-- 1. entity_types -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS entity_types (
    key         TEXT PRIMARY KEY,                 -- e.g. 'person'; also the IdentifierAgent label
    label       TEXT NOT NULL,                    -- display name
    description TEXT NOT NULL,                     -- one line; guides detection
    page_folder TEXT NOT NULL,                     -- on-disk folder for this type's pages
    position    INTEGER NOT NULL DEFAULT 0,        -- ordering in the admin UI
    updated_at  TIMESTAMP NOT NULL DEFAULT now(),
    updated_by  TEXT
);

-- 2. entity_type_fields -----------------------------------------------------
CREATE TABLE IF NOT EXISTS entity_type_fields (
    id          SERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL REFERENCES entity_types(key) ON DELETE CASCADE ON UPDATE CASCADE,
    field_key   TEXT NOT NULL,                     -- e.g. 'role'; becomes a frontmatter key
    label       TEXT NOT NULL,
    description TEXT NOT NULL,                     -- guides the AttributeAgent ("job title, if stated")
    is_list     BOOLEAN NOT NULL DEFAULT FALSE,    -- true = extract a list of values
    position    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (entity_type, field_key)
);

CREATE INDEX IF NOT EXISTS entity_type_fields_type_idx
    ON entity_type_fields (entity_type);

-- 3. relationship_types -----------------------------------------------------
-- subject_type / object_type are the domain-range guardrail: a triple whose
-- endpoints don't match is rejected before it is written. NULL = connects any
-- type. ON DELETE SET NULL so removing a type loosens, never orphans, a predicate.
CREATE TABLE IF NOT EXISTS relationship_types (
    key          TEXT PRIMARY KEY,                 -- e.g. 'works_at'
    label        TEXT NOT NULL,
    description  TEXT NOT NULL,                     -- the RelationshipAgent picks from these
    subject_type TEXT REFERENCES entity_types(key) ON DELETE SET NULL ON UPDATE CASCADE,
    object_type  TEXT REFERENCES entity_types(key) ON DELETE SET NULL ON UPDATE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    updated_at   TIMESTAMP NOT NULL DEFAULT now(),
    updated_by   TEXT
);

-- 4. question_entities ------------------------------------------------------
-- Read-side provenance. One row per entity the brain surfaced answering a
-- question, with HOW it was surfaced (a direct vector/keyword hit, or pulled in
-- as a 1-hop graph neighbour) and its rank in the merged source list. Lets
-- "what does the brain resurface?" be a plain query. CASCADE on both sides:
-- deleting a question or an entity drops its surfacing rows.
CREATE TABLE IF NOT EXISTS question_entities (
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    entity_id   INTEGER NOT NULL REFERENCES entities(id)  ON DELETE CASCADE,
    method      TEXT    NOT NULL CHECK (method IN ('vector', 'graph_neighbor')),
    rank        INTEGER NOT NULL,                  -- position in the merged source list (1 = top)
    PRIMARY KEY (question_id, entity_id)
);

CREATE INDEX IF NOT EXISTS question_entities_entity_idx
    ON question_entities (entity_id);

-- ---------------------------------------------------------------------------
-- Seed today's ontology BEFORE foreign-keying onto it.
-- ---------------------------------------------------------------------------

INSERT INTO entity_types (key, label, description, page_folder, position) VALUES
    ('person',  'Person',  'An individual human — a named contact, colleague, client-side stakeholder, or anyone referred to by name in communications.', 'persons',   1),
    ('company', 'Company', 'An organisation or business — a client, prospect, vendor, partner, or any named legal entity.',                              'companies', 2),
    ('project', 'Project', 'A named engagement, deal, mandate, or initiative that work is organised around.',                                           'projects',  3)
ON CONFLICT (key) DO NOTHING;

INSERT INTO entity_type_fields (entity_type, field_key, label, description, is_list, position) VALUES
    ('person',  'role',         'Role',         'The person''s job title or role, if the text states it.',                                         FALSE, 1),
    ('person',  'email',        'Email',        'The person''s email address, if present.',                                                        FALSE, 2),
    ('person',  'location',     'Location',     'Where the person is based, if stated.',                                                           FALSE, 3),
    ('person',  'relationship', 'Relationship', 'This person''s relationship to us: one of client, prospect, peer, internal, vendor.',             FALSE, 4),
    ('company', 'sector',       'Sector',       'The company''s industry or sector, if stated.',                                                  FALSE, 1),
    ('company', 'location',     'Location',     'Where the company is based, if stated.',                                                          FALSE, 2),
    ('company', 'relationship', 'Relationship', 'This company''s relationship to us: one of client, prospect, peer, internal, vendor.',           FALSE, 3),
    ('project', 'status',       'Status',       'The project''s lifecycle status: one of scoping, active, completed, on-hold.',                    FALSE, 1)
ON CONFLICT (entity_type, field_key) DO NOTHING;

INSERT INTO relationship_types (key, label, description, subject_type, object_type, position) VALUES
    ('works_at',       'Works at',       'The person is employed by / works at the company.',                              'person',  'company', 1),
    ('key_contact_at', 'Key contact at', 'The person is a primary point of contact at the company (not necessarily an employee).', 'person', 'company', 2),
    ('leads',          'Leads',          'The person leads or is the responsible lead for the project.',                   'person',  'project', 3),
    ('has_client',     'Has client',     'The project is delivered for / on behalf of the company (its client).',          'project', 'company', 4)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Foreign-key the existing columns onto the new vocabulary. Guarded so the
-- migration is safe to re-run. ON UPDATE CASCADE lets an admin rename a type or
-- predicate key and have existing rows follow; ON DELETE RESTRICT stops a type
-- or predicate from being deleted while data still uses it.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_type_fkey') THEN
        ALTER TABLE entities
            ADD CONSTRAINT entities_type_fkey
            FOREIGN KEY (type) REFERENCES entity_types(key)
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationships_predicate_fkey') THEN
        ALTER TABLE relationships
            ADD CONSTRAINT relationships_predicate_fkey
            FOREIGN KEY (predicate) REFERENCES relationship_types(key)
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
