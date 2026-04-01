type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  normalized: string;
};

export type GitHubReleaseSummary = {
  version: ParsedVersion;
  releaseUrl: string;
  releaseNotes: string | null;
};

const VERSION_PATTERN =
  /^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseNumericIdentifier(value: string) {
  return /^\d+$/.test(value) ? Number(value) : null;
}

export function parseVersion(input: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(input.trim());
  if (!match?.groups) {
    return null;
  }

  const prerelease = match.groups.prerelease?.split('.').filter(Boolean) ?? [];
  const normalized = `${match.groups.major}.${match.groups.minor}.${match.groups.patch}${
    prerelease.length > 0 ? `-${prerelease.join('.')}` : ''
  }`;

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    prerelease,
    normalized
  };
}

export function isPrerelease(version: ParsedVersion) {
  return version.prerelease.length > 0;
}

export function compareVersions(left: ParsedVersion, right: ParsedVersion) {
  if (left.major !== right.major) {
    return left.major - right.major;
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) {
    return 0;
  }

  if (left.prerelease.length === 0) {
    return 1;
  }

  if (right.prerelease.length === 0) {
    return -1;
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];

    if (leftPart === undefined) {
      return -1;
    }

    if (rightPart === undefined) {
      return 1;
    }

    const leftNumeric = parseNumericIdentifier(leftPart);
    const rightNumeric = parseNumericIdentifier(rightPart);

    if (leftNumeric !== null && rightNumeric !== null) {
      if (leftNumeric !== rightNumeric) {
        return leftNumeric - rightNumeric;
      }
      continue;
    }

    if (leftNumeric !== null) {
      return -1;
    }

    if (rightNumeric !== null) {
      return 1;
    }

    if (leftPart !== rightPart) {
      return leftPart.localeCompare(rightPart);
    }
  }

  return 0;
}

export function selectLatestRelease(
  releases: GitHubReleaseSummary[],
  currentVersion: string
): GitHubReleaseSummary | null {
  const parsedCurrentVersion = parseVersion(currentVersion);
  if (!parsedCurrentVersion) {
    throw new Error(`Unsupported app version: ${currentVersion}`);
  }

  const allowPrerelease = isPrerelease(parsedCurrentVersion);

  const candidates = releases
    .filter((release) => allowPrerelease || !isPrerelease(release.version))
    .filter((release) => compareVersions(release.version, parsedCurrentVersion) > 0)
    .sort((left, right) => compareVersions(right.version, left.version));

  return candidates[0] ?? null;
}
