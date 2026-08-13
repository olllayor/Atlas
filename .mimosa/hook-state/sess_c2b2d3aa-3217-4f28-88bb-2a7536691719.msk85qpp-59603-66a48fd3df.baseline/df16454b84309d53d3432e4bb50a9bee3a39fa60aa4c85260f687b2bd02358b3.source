import { isReducedMotion } from '../lib/reducedMotion';

import { XAINavbar } from './xai/XAINavbar';
import { XAIHero } from './xai/XAIHero';
import { XAIFeatures } from './xai/XAIFeatures';
import { XAIModels } from './xai/XAIModels';
import { XAIDocsSection } from './xai/XAIDocsSection';
import { XAIFooter } from './xai/XAIFooter';

interface XAILandingPageProps {
  onBackToApp?: () => void;
}

/**
 * The CSS kill switch sets `scroll-behavior: auto !important` on the root, but an
 * explicit `behavior` argument to scrollIntoView/scrollTo is an argument, not a CSS
 * property — it wins over the stylesheet. So passing 'smooth' unconditionally slips
 * straight past Reduce motion, and these in-page jumps have to decide in JS.
 *
 * Reduced motion means "get me there without the travel", not "don't go": the
 * navigation still happens, it just lands instantly.
 *
 * Imperative read rather than the hook — this runs inside a click handler, where the
 * current value is what matters and a re-render would buy nothing.
 */
function scrollBehavior(): ScrollBehavior {
  return isReducedMotion() ? 'auto' : 'smooth';
}

export function XAILandingPage({ onBackToApp }: XAILandingPageProps) {
  return (
    <div className="xai-page">
      <XAINavbar onBackToApp={onBackToApp} />
      <XAIHero
        onPrimaryClick={onBackToApp}
        onSecondaryClick={() => {
          const docs = document.getElementById('docs');
          if (docs) {
            docs.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
          }
        }}
      />
      <XAIFeatures />
      <XAIModels />
      <XAIDocsSection
        onPrimaryClick={onBackToApp}
        onSecondaryClick={() => {
          const models = document.getElementById('models');
          if (models) {
            models.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
          }
        }}
      />
      <XAIFooter onCTAClick={onBackToApp} />
    </div>
  );
}
