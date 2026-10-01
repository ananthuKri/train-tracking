import { useConfig } from '@/api/hooks';

export const DATA_DISCLAIMER = 'Data from licensed providers via RailTrack Live. Estimated positions are interpolated, not GPS.';

export function Footer() {
  const { data: config } = useConfig();
  return (
    <footer className="mt-auto border-t bg-muted/30">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p data-testid="data-disclaimer">{DATA_DISCLAIMER}</p>
        <p>
          {config ? (
            <>
              Active provider: <span className="font-medium text-foreground">{config.activeProvider.name}</span>
              {config.activeProvider.attribution ? ` · ${config.activeProvider.attribution}` : ''}
            </>
          ) : (
            'RailTrack Live'
          )}
          {' · '}Not affiliated with Indian Railways.
        </p>
      </div>
    </footer>
  );
}
