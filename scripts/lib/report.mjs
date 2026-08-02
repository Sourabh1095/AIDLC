// Shared reporting for the repo checks. Each check builds a list of problems and
// exits non-zero if any are errors; warnings are printed and do not fail the build.
export function createReport(name) {
  const errors = [];
  const warnings = [];
  let checks = 0;

  return {
    /** Assert `cond`; on failure record an error naming the file and what to do. */
    assert(cond, where, message) {
      checks++;
      if (!cond) errors.push({ where, message });
      return cond;
    },
    warn(where, message) {
      warnings.push({ where, message });
    },
    error(where, message) {
      checks++;
      errors.push({ where, message });
    },
    counted(n) {
      checks += n;
    },
    /** Print and exit. Returns nothing — it terminates the process. */
    finish() {
      for (const w of warnings) console.log(`  ! ${w.where}\n      ${w.message}`);
      if (errors.length) {
        console.log(`\n${name}: ${errors.length} problem(s)\n`);
        for (const e of errors) console.log(`  ✗ ${e.where}\n      ${e.message}`);
        console.log("");
        process.exit(1);
      }
      const w = warnings.length ? `, ${warnings.length} warning(s)` : "";
      console.log(`${name}: ok (${checks} checks${w})`);
    },
  };
}
