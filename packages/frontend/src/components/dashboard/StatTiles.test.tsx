import { render, screen } from '@testing-library/react';
import '@/i18n';
import { StatTiles } from './StatTiles';
it('renders the six tiles with formatted values', () => {
  render(<StatTiles info={{ status: 'ready', containerName: 'mc', startedAt: null, uptimeSeconds: null, version: null, players: { online: 3, max: 20, names: [] }, mspt: 4.26, tps: null, stats: { cpuPercent: 42.4, memUsed: 2 * 1024 ** 3, memLimit: 4 * 1024 ** 3 }, worldBytes: 1.5 * 1024 ** 3, diskFree: 10 * 1024 ** 3 }} />);
  expect(screen.getByText('3 / 20')).toBeInTheDocument();
  expect(screen.getByText('42 %')).toBeInTheDocument();
  expect(screen.getByText('2 GB / 4 GB')).toBeInTheDocument();
  expect(screen.getByText('4.3 ms')).toBeInTheDocument();
  expect(screen.getByText('1.5 GB')).toBeInTheDocument();
  expect(screen.getByText('10 GB')).toBeInTheDocument();
});
