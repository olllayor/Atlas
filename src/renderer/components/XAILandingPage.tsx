import { XAINavbar } from './xai/XAINavbar';
import { XAIHero } from './xai/XAIHero';
import { XAIFeatures } from './xai/XAIFeatures';
import { XAIModels } from './xai/XAIModels';
import { XAIDocsSection } from './xai/XAIDocsSection';
import { XAIFooter } from './xai/XAIFooter';

interface XAILandingPageProps {
  onBackToApp?: () => void;
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
            docs.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
            models.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }}
      />
      <XAIFooter onCTAClick={onBackToApp} />
    </div>
  );
}
