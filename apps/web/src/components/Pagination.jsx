import React from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const Pagination = ({ page, totalPages, onPageChange }) => {
  if (totalPages <= 1) return null

  const getPageNumbers = () => {
    const pages = []
    const delta = 2
    const start = Math.max(1, page - delta)
    const end = Math.min(totalPages, page + delta)

    if (start > 1) {
      pages.push(1)
      if (start > 2) pages.push('...')
    }

    for (let i = start; i <= end; i++) {
      pages.push(i)
    }

    if (end < totalPages) {
      if (end < totalPages - 1) pages.push('...')
      pages.push(totalPages)
    }

    return pages
  }

  return (
    <div className="flex items-center justify-center gap-1 py-4">
      <Button
        variant="ghost"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      {getPageNumbers().map((p, i) =>
        p === '...' ? (
          <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground text-sm">...</span>
        ) : (
          <Button
            key={p}
            variant={p === page ? 'default' : 'ghost'}
            size="sm"
            className="min-w-9"
            onClick={() => onPageChange(p)}
          >
            {p}
          </Button>
        )
      )}

      <Button
        variant="ghost"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

export default Pagination
