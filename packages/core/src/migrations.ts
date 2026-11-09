// Numbered migrations, applied in order inside a transaction each, tracked by
// `pragma user_version`. They are embedded here, not read from .sql files:
// a standalone Next build and a packaged desktop app do not reliably carry
// loose files next to compiled code.
//
// NEVER edit a migration that has shipped. Add the next number.

export interface Migration { version: number; name: string; sql: string; }

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "projects, patterns, revisions, activity, settings, jobs",
    sql: `
      create table meta (key text primary key, value text not null);
      insert into meta (key, value) values ('rev', '0');

      create table projects (
        id text primary key,
        name text not null,
        description text not null default '',
        swatch_id text,
        cover_yarn_id text,
        example integer not null default 0,
        archived_at text,
        deleted_at text,
        created_at text not null,
        updated_at text not null
      );

      create table patterns (
        id text primary key,
        project_id text not null references projects(id) on delete cascade,
        name text not null,
        size text not null,
        duration_ms integer not null default 0,
        doc text not null,
        version integer not null default 1,
        created_at text not null,
        updated_at text not null
      );
      create index patterns_project on patterns (project_id);

      create table pattern_revisions (
        id text primary key,
        pattern_id text not null references patterns(id) on delete cascade,
        snapshot text not null,
        author text not null,
        label text,
        created_at text not null
      );
      create index revisions_pattern on pattern_revisions (pattern_id, created_at);

      create table activity (
        id text primary key,
        project_id text references projects(id) on delete cascade,
        actor text not null,
        action text not null,
        subject text,
        detail text,
        created_at text not null
      );
      create index activity_project on activity (project_id, created_at);

      create table settings (key text primary key, value text not null);

      create table jobs (
        id text primary key,
        kind text not null,
        status text not null,
        project_id text,
        input text,
        progress text,
        result text,
        error text,
        created_at text not null,
        updated_at text not null,
        finished_at text
      );
      create index jobs_status on jobs (status, created_at);
    `,
  },
  {
    version: 2,
    name: "yarn",
    sql: `
      create table yarn (
        id text primary key,
        project_id text not null references projects(id) on delete cascade,
        kind text not null,
        name text not null,
        file text not null,
        original_name text not null,
        mime text not null,
        bytes integer not null,
        hash text not null,
        width integer,
        height integer,
        duration_ms integer,
        tags text not null default '[]',
        meta text not null default '{}',
        deleted_at text,
        created_at text not null,
        updated_at text not null
      );
      create index yarn_project on yarn (project_id, deleted_at);
      create index yarn_hash on yarn (project_id, hash);
    `,
  },
  {
    version: 3,
    name: "swatches",
    sql: `
      create table swatches (
        id text primary key,
        project_id text not null references projects(id) on delete cascade,
        name text not null,
        data text not null,
        created_at text not null,
        updated_at text not null
      );
      create index swatches_project on swatches (project_id);
    `,
  },
  {
    version: 4,
    name: "knits",
    sql: `
      create table knits (
        id text primary key,
        project_id text not null references projects(id) on delete cascade,
        pattern_id text,
        pattern_name text not null,
        job_id text,
        batch_id text,
        label text not null,
        file text not null,
        kind text not null,
        format text not null,
        width integer not null,
        height integer not null,
        bytes integer not null,
        duration_ms integer,
        hash text not null,
        report text not null default '{}',
        created_at text not null
      );
      create index knits_project on knits (project_id, created_at);
      create index knits_hash on knits (project_id, hash);
    `,
  },
  {
    version: 5,
    name: "parts",
    sql: `
      create table parts (
        id text primary key,
        project_id text references projects(id) on delete cascade,
        builtin integer not null default 0,
        name text not null,
        description text not null default '',
        category text not null default 'other',
        tags text not null default '[]',
        kind text not null,
        data text not null,
        slots text not null default '[]',
        aspect real not null default 1,
        duration_ms integer not null default 0,
        version integer not null default 1,
        created_at text not null,
        updated_at text not null
      );
      create index parts_project on parts (project_id);
    `,
  },
  {
    version: 6,
    name: "folders",
    sql: `
      alter table patterns add column folder text not null default '';
      alter table yarn add column folder text not null default '';
      alter table parts add column folder text not null default '';
      alter table swatches add column folder text not null default '';
      alter table knits add column folder text not null default '';

      create table folders (
        project_id text not null references projects(id) on delete cascade,
        section text not null,
        path text not null,
        created_at text not null,
        primary key (project_id, section, path)
      );
    `,
  },
  {
    version: 7,
    name: "chats",
    // A conversation with the studio's own model. `messages` is what was sent to the
    // model and what it answered, verbatim; `system` is its instructions as they were
    // when it started. Both are sent back unchanged on every later turn (chats.ts).
    sql: `
      create table chats (
        id text primary key,
        project_id text references projects(id) on delete cascade,
        pattern_id text references patterns(id) on delete set null,
        title text not null,
        system text not null,
        messages text not null default '[]',
        job_ids text not null default '[]',
        created_at text not null,
        updated_at text not null
      );
      create index chats_updated on chats (updated_at);
    `,
  },
  {
    version: 8,
    name: "briefs",
    // A project's Brief: its profile, what the person and their model know about the brand,
    // and its reference, files for a model to look at. A reference file is Yarn on another
    // shelf, with folders of its own: one import, one way to delete and bring back, and
    // moving a file between Yarn and the reference is changing its shelf. `previous` is the
    // profile before it was last replaced, by a build or a model, for Undo. `site` is the
    // business's website and what its last sync did, so a sync can be run again from there.
    sql: `
      alter table yarn add column shelf text not null default 'yarn';

      create table briefs (
        project_id text primary key references projects(id) on delete cascade,
        profile text not null default '',
        previous text,
        notes text not null default '',
        source text not null default '{}',
        by text not null default 'human',
        built_at text,
        site text not null default '{}',
        updated_at text not null
      );
    `,
  },
  {
    version: 9,
    name: "knit tags",
    // Tags on a knit, as Yarn has them: words to find it by ("launch", "winter"), a JSON list.
    sql: `alter table knits add column tags text not null default '[]';`,
  },
  {
    version: 10,
    name: "knit posts",
    // What goes with a knit when it is posted: its caption, hashtags and a track from the
    // project's audio, written by the person's model or by the person, as JSON.
    sql: `alter table knits add column post text not null default '{}';`,
  },
  {
    version: 11,
    name: "knits seen",
    // When the person first looked at a knit, so a new one can say so. What was knitted
    // before this counts as seen: an update should not light up a whole library.
    sql: `
      alter table knits add column seen_at text;
      update knits set seen_at = created_at;
    `,
  },
  {
    version: 12,
    name: "usage",
    // What the person's own API key spent: a row per answer from the model, its tokens and
    // its cost in dollars at the prices of the day, so a limit can stop a run in time.
    sql: `
      create table usage (
        id text primary key,
        at text not null,
        kind text not null,
        model text not null,
        project_id text,
        chat_id text,
        input integer not null default 0,
        output integer not null default 0,
        cache_write integer not null default 0,
        cache_read integer not null default 0,
        cost real not null default 0
      );
      create index usage_at on usage (at);
    `,
  },
  {
    version: 13,
    name: "social",
    // The person's own accounts on Instagram, TikTok, LinkedIn, Threads, X and YouTube, and
    // what is posted to them. Tokens are never here: they live in the OS's secret store, by
    // the account's id. A post keeps the knits it is of as a list, so a carousel is one post;
    // a knit deleted before its post goes out fails that post, in words, at its time.
    sql: `
      create table social_accounts (
        id text primary key,
        platform text not null,
        external_id text not null,
        name text not null default '',
        handle text not null default '',
        avatar text,
        scopes text not null default '[]',
        status text not null default 'ok',
        note text,
        expires_at text,
        connected_at text not null,
        updated_at text not null,
        unique (platform, external_id)
      );
      create table social_posts (
        id text primary key,
        project_id text not null references projects(id) on delete cascade,
        account_id text references social_accounts(id) on delete set null,
        platform text not null,
        knit_ids text not null default '[]',
        caption text not null default '',
        title text not null default '',
        options text not null default '{}',
        scheduled_at text,
        status text not null,
        external_id text,
        url text,
        error text,
        attempts integer not null default 0,
        posted_at text,
        by text not null default 'human',
        metrics text,
        metrics_at text,
        created_at text not null,
        updated_at text not null
      );
      create index social_posts_due on social_posts (status, scheduled_at);
      create index social_posts_project on social_posts (project_id, created_at);
    `,
  },
  {
    version: 14,
    name: "post-metrics",
    // How each post did, as the platform counted it each time knitted asked: a few times over
    // its first month, so a post can be compared with others at the same age. The post keeps
    // its latest numbers too, and a note when the platform gives none (LinkedIn, a Story gone).
    sql: `
      create table social_metrics (
        post_id text not null references social_posts(id) on delete cascade,
        at text not null,
        metrics text not null
      );
      create index social_metrics_post on social_metrics (post_id, at);
      alter table social_posts add column metrics_note text;
    `,
  },
  {
    version: 15,
    name: "part-editing",
    // A Part is edited in the pattern editor through a pattern of its own, hidden from the
    // project's Patterns: part_id says which Part it edits, and every change goes to the Part.
    // part_base is the Part's version when this editing began, so one sitting is one version.
    sql: `
      alter table patterns add column part_id text;
      alter table patterns add column part_base integer;
      create index patterns_part on patterns (part_id);
    `,
  },
  {
    version: 16,
    name: "library",
    // The Library: Yarn every project can use, kept as a project of its own (LIBRARY_ID) so a
    // file there is stored, found, deleted and brought back the way any project's Yarn is.
    // It is never listed with the projects.
    sql: `
      insert or ignore into projects (id, name, description, created_at, updated_at)
        values ('library', 'Library', 'What every project shares.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    `,
  },
  {
    version: 17,
    name: "designs",
    // Design sheets: a site's UI on one board, in sections of frames, kept as one document.
    // Each change keeps the version before it in design_versions, so Undo can walk back
    // through what a person or a model did.
    sql: `
      create table designs (
        id text primary key,
        project_id text not null references projects(id) on delete cascade,
        name text not null,
        data text not null,
        version integer not null default 1,
        created_at text not null,
        updated_at text not null,
        deleted_at text
      );
      create index designs_project on designs (project_id);
      create table design_versions (
        design_id text not null references designs(id) on delete cascade,
        version integer not null,
        name text not null,
        data text not null,
        actor text not null,
        at text not null,
        primary key (design_id, version)
      );
    `,
  },
  {
    version: 18,
    name: "knit favourites",
    // A knit the person marked as one they like: when, or null.
    sql: `alter table knits add column favorite_at text;`,
  },
  {
    version: 19,
    name: "comments",
    // A note pinned to a spot on a knit (and a moment, in a video) or on a frame of a design
    // sheet, by the person or their model, with replies. x and y are fractions of the picture
    // or the frame, so a pin stays put at any size. A reply has a parent and no pin.
    sql: `
      create table comments (
        id text primary key,
        project_id text not null references projects(id) on delete cascade,
        knit_id text references knits(id) on delete cascade,
        design_id text references designs(id) on delete cascade,
        frame_id text,
        parent_id text references comments(id) on delete cascade,
        x real,
        y real,
        time_ms integer,
        body text not null,
        author text not null,
        resolved_at text,
        created_at text not null,
        updated_at text not null
      );
      create index comments_knit on comments (knit_id);
      create index comments_design on comments (design_id);
      create index comments_parent on comments (parent_id);
    `,
  },
  {
    version: 20,
    name: "knit versions and formats",
    // A knit is one pattern at one size (and one row of a batch): its unit. Each look of it is
    // a version; the same look as another file type or scale is a format of that version.
    // chosen_at: when the person picked the file, or knitted it again. head: the one file
    // Knits shows for the knit. Older rows get unit and look when the library is opened
    // (knit-versions.ts), since that reads their labels and the pattern's history.
    sql: `
      alter table knits add column unit text;
      alter table knits add column look text;
      alter table knits add column scale integer not null default 1;
      alter table knits add column chosen_at text;
      alter table knits add column head integer not null default 1;
      create index knits_unit on knits (project_id, unit);
      create index knits_head on knits (project_id, head, created_at);
    `,
  },
];
