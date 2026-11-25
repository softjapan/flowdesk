/**
 * マイグレーションの SQL から、データを失う・動いている版を壊す操作を
 * 見つける（第17章、docs/migrations.md）。scripts/check-migrations.ts と
 * テスト（migration-rules.test.ts）が使う。
 *
 * 本番は「新しい版のタスクが起動する前に migrate を流す」ので、
 * マイグレーションの直後は古い版の web・worker がまだ動いている。
 * 古い版が読み書きする列を消す・名前を変える・型を変える操作は、
 * expand と contract の手順に分ける。
 *
 * 意図した操作（contract の段階）は、文の直前に理由つきで書く：
 *   -- migration-safety: allow drop-column 旧列 phone は 2026-12-01 の版から使っていない
 */

export type RuleId =
  | "drop-table"
  | "drop-column"
  | "rename-table"
  | "rename-column"
  | "rename-enum"
  | "alter-column-type"
  | "set-not-null"
  | "add-not-null-column"
  | "truncate"
  | "create-index-blocking";

export const RULES: Record<RuleId, string> = {
  "drop-table":
    "テーブルを消すと、データと、それを読む古い版が壊れる",
  "drop-column":
    "列を消すと、データと、その列を読み書きする古い版が壊れる（contract の段階で消す）",
  "rename-table":
    "テーブルの名前を変えると、古い版が古い名前で読み書きできなくなる",
  "rename-column":
    "列の名前を変えると、古い版が古い名前で読み書きできなくなる（新しい列を足して移す）",
  "rename-enum":
    "enum（型・値）の名前を変えると、古い版の値が書けなくなる",
  "alter-column-type":
    "列の型の変更は、表の書き換え（長いロック）と値の変換の失敗・切り捨てがありうる",
  "set-not-null":
    "NOT NULL の追加は、古い版が NULL を書くと失敗し、既存の NULL があると適用が失敗する",
  "add-not-null-column":
    "既定値のない NOT NULL の列の追加は、行があると失敗し、古い版の INSERT も失敗する",
  truncate: "TRUNCATE は全行を消す",
  "create-index-blocking":
    "既存のテーブルへの CREATE INDEX（CONCURRENTLY なし）は、作り終わるまで書き込みを止める",
};

export type Finding = {
  rule: RuleId;
  /** 文の始まりの行（1 から） */
  line: number;
  statement: string;
};

export type Statement = {
  sql: string;
  line: number;
  /** 文の直前の `-- migration-safety: allow <rule> <理由>` */
  allowed: Map<RuleId, string>;
};

const ALLOW = /^--\s*migration-safety:\s*allow\s+([a-z-]+)\s*(.*)$/;

/**
 * SQL を文に分ける。文字列（'…'）・識別子（"…"）・ドル引用（$$…$$）・
 * コメントの中の ; では分けない。コメントは文から除く
 */
export function splitStatements(sql: string): Statement[] {
  const statements: Statement[] = [];
  let current = "";
  let startLine = 0;
  let line = 1;
  let allowed = new Map<RuleId, string>();
  let i = 0;

  const flush = () => {
    const text = current.trim();
    if (text)
      statements.push({ sql: text, line: startLine, allowed });
    current = "";
    startLine = 0;
    allowed = new Map();
  };
  const append = (s: string) => {
    if (!startLine && s.trim()) startLine = line;
    current += s;
    line += s.split("\n").length - 1;
  };

  while (i < sql.length) {
    const ch = sql[i]!;
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      const comment = sql.slice(i, end === -1 ? sql.length : end);
      const m = ALLOW.exec(comment.trim());
      if (m && !current.trim() && m[1]! in RULES) {
        allowed.set(m[1] as RuleId, m[2]!.trim());
      }
      i += comment.length;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      const comment = sql.slice(i, end === -1 ? sql.length : end + 2);
      line += comment.split("\n").length - 1;
      current += " ";
      i += comment.length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch && sql[j + 1] === ch) j += 2;
        else if (sql[j] === ch) break;
        else j++;
      }
      append(sql.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const body = sql.slice(
        i,
        end === -1 ? sql.length : end + tag.length,
      );
      append(body);
      i += body.length;
      continue;
    }
    if (ch === ";") {
      flush();
      i++;
      continue;
    }
    append(ch);
    i++;
  }
  flush();
  return statements;
}

/** かっこ・引用の外のカンマで分ける（ALTER TABLE の複数の操作） */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const QUALIFIED = String.raw`${IDENT}(?:\.${IDENT})?`;

/** "public"."user" と user を同じ名前として比べる */
function tableKey(name: string): string {
  const last = name.split(/\.(?=(?:[^"]*"[^"]*")*[^"]*$)/).at(-1)!;
  return last.replace(/^"|"$/g, "").replace(/""/g, '"');
}

function alterTableActions(
  sql: string,
): { table: string; actions: string[] } | null {
  const m = new RegExp(
    String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QUALIFIED})\s+([\s\S]*)$`,
    "i",
  ).exec(sql);
  if (!m) return null;
  return { table: tableKey(m[1]!), actions: splitTopLevel(m[2]!) };
}

function checkAlterAction(action: string): RuleId | null {
  const a = action.replace(/\s+/g, " ").trim();
  if (/^DROP (?!CONSTRAINT\b)/i.test(a)) return "drop-column";
  if (/^RENAME TO\b/i.test(a)) return "rename-table";
  if (/^RENAME (?!CONSTRAINT\b)/i.test(a)) return "rename-column";
  if (
    new RegExp(
      String.raw`^ALTER (?:COLUMN )?${IDENT} (?:SET DATA )?TYPE\b`,
      "i",
    ).test(a)
  ) {
    return "alter-column-type";
  }
  if (
    new RegExp(
      String.raw`^ALTER (?:COLUMN )?${IDENT} SET NOT NULL\b`,
      "i",
    ).test(a)
  ) {
    return "set-not-null";
  }
  if (
    /^ADD (?!CONSTRAINT\b|PRIMARY\b|UNIQUE\b|CHECK\b|FOREIGN\b|EXCLUDE\b)/i.test(
      a,
    )
  ) {
    const notNull = /\bNOT NULL\b/i.test(a);
    const hasDefault = /\bDEFAULT\b/i.test(a);
    const generated = /\bGENERATED\b/i.test(a);
    if (notNull && !hasDefault && !generated)
      return "add-not-null-column";
  }
  return null;
}

/**
 * 1 つのマイグレーション（migration.sql）を調べる。同じファイルで作った
 * テーブル（まだ誰も使っていない）への列の追加・インデックスは止めない
 */
export function checkMigration(sql: string): {
  findings: Finding[];
  allowedFindings: (Finding & { reason: string })[];
} {
  const statements = splitStatements(sql);
  const created = new Set<string>();
  for (const s of statements) {
    const m = new RegExp(
      String.raw`^CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED})`,
      "i",
    ).exec(s.sql);
    if (m) created.add(tableKey(m[1]!));
  }

  const findings: Finding[] = [];
  const allowedFindings: (Finding & { reason: string })[] = [];
  for (const s of statements) {
    const rules = new Set<RuleId>();
    const flat = s.sql.replace(/\s+/g, " ");

    if (/^DROP TABLE\b/i.test(flat)) rules.add("drop-table");
    if (/^TRUNCATE\b/i.test(flat)) rules.add("truncate");
    if (/^ALTER TYPE \S+ RENAME\b/i.test(flat))
      rules.add("rename-enum");

    const index = new RegExp(
      String.raw`^CREATE (?:UNIQUE )?INDEX (CONCURRENTLY )?(?:IF NOT EXISTS )?(?:${IDENT} )?ON (?:ONLY )?(${QUALIFIED})`,
      "i",
    ).exec(flat);
    if (index && !index[1] && !created.has(tableKey(index[2]!))) {
      rules.add("create-index-blocking");
    }

    const alter = alterTableActions(s.sql);
    if (alter && !created.has(alter.table)) {
      for (const action of alter.actions) {
        const rule = checkAlterAction(action);
        if (rule) rules.add(rule);
      }
    }

    for (const rule of rules) {
      const finding = {
        rule,
        line: s.line,
        statement:
          flat.length > 120 ? `${flat.slice(0, 117)}...` : flat,
      };
      const reason = s.allowed.get(rule);
      if (reason) allowedFindings.push({ ...finding, reason });
      else findings.push(finding);
    }
  }
  return { findings, allowedFindings };
}

/**
 * 書き方の誤った allow（知らないルール名・理由なし）の行。黙って
 * 無視すると、許したつもりの文が止まり、理由が残らないので失敗にする
 */
export function invalidAllowComments(sql: string): number[] {
  return sql.split("\n").flatMap((text, i) => {
    if (!/--\s*migration-safety:/.test(text)) return [];
    const m = ALLOW.exec(text.trim());
    return m && m[1]! in RULES && m[2]!.trim() ? [] : [i + 1];
  });
}
