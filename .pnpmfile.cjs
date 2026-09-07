/** Eve runs this repository's maintenance agent, not the published diff0 CLI. */
module.exports = {
  hooks: {
    // Supported by pnpm >=10.28. Only the tarball manifest changes; installs
    // and Eve discovery continue to see eve in the local runtime dependencies.
    beforePacking(pkg) {
      if (pkg.name !== "@knowbody/diff0") return pkg;
      const { eve, ...dependencies } = pkg.dependencies;
      if (!eve) throw new Error("Expected the maintenance agent's Eve dependency.");
      return { ...pkg, dependencies };
    },
  },
};
