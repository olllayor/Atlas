import assert from 'node:assert/strict';
import test from 'node:test';

import { DESIGN_TEMPLATES } from '../src/shared/designTemplates';
import { validateSiteArtifact } from '../src/shared/sites';

test('design templates validate cleanly with zero errors and zero warnings', () => {
  assert.ok(DESIGN_TEMPLATES.length >= 4, 'Expected at least 4 starter design templates');

  for (const template of DESIGN_TEMPLATES) {
    const result = validateSiteArtifact(template.files);
    assert.equal(result.ok, true, `Template "${template.name}" must pass artifact validation`);
    assert.equal(result.errors.length, 0, `Template "${template.name}" must have zero errors`);
    assert.equal(
      result.warnings.length,
      0,
      `Template "${template.name}" must have zero warnings so publish is never blocked out-of-the-box: ${JSON.stringify(result.warnings)}`
    );
    assert.ok(result.totalBytes > 0, `Template "${template.name}" must contain non-empty files`);
  }
});
