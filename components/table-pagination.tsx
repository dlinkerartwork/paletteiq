'use client';

type TablePaginationProps = {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  label?: string;
};

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export default function TablePagination({ total, page, pageSize, onPage, onPageSize, label = 'rows' }: TablePaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), pageCount);
  const first = total ? (current - 1) * pageSize + 1 : 0;
  const last = Math.min(total, current * pageSize);
  return <div className="table-pagination" role="navigation" aria-label={`${label} pagination`}>
    <span>{first}–{last} of {total} {label}</span>
    <label>Rows per page <select aria-label={`${label} rows per page`} value={pageSize} onChange={event => onPageSize(Number(event.target.value))}>{PAGE_SIZES.map(size => <option value={size} key={size}>{size}</option>)}</select></label>
    <div className="table-pagination-actions">
      <button type="button" className="outline-btn" disabled={current <= 1} onClick={() => onPage(current - 1)}>Previous</button>
      <span>Page {current} of {pageCount}</span>
      <button type="button" className="outline-btn" disabled={current >= pageCount} onClick={() => onPage(current + 1)}>Next</button>
    </div>
  </div>;
}
