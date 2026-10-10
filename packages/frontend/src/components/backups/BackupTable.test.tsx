import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { BackupTable } from './BackupTable';
const entries = [{ name: 'b.tgz', size: 2048, modifiedAt: '2026-10-10T10:00:00Z' }, { name: 'a.tgz', size: 1024, modifiedAt: '2026-10-09T10:00:00Z' }];
it('renders rows and fires callbacks for admins', () => {
  const onDelete = vi.fn(); const onDownload = vi.fn(); const onRestore = vi.fn();
  render(<BackupTable entries={entries} isAdmin busy={false} onRestore={onRestore} onDelete={onDelete} onDownload={onDownload} />);
  expect(screen.getByText('b.tgz')).toBeInTheDocument();
  expect(screen.getByText('2 KB')).toBeInTheDocument();
  fireEvent.click(screen.getAllByLabelText('download')[0]);
  expect(onDownload).toHaveBeenCalledWith('b.tgz');
  fireEvent.click(screen.getAllByLabelText('restore')[0]);
  expect(onRestore).toHaveBeenCalledWith('b.tgz');
  fireEvent.click(screen.getAllByLabelText('delete')[1]);
  expect(onDelete).toHaveBeenCalledWith('a.tgz');
});
it('hides actions for viewers', () => {
  render(<BackupTable entries={entries} isAdmin={false} busy={false} onRestore={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} />);
  expect(screen.queryByLabelText('download')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('restore')).not.toBeInTheDocument();
});
