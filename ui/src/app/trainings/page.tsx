'use client';

// DUAL BUILD: the trainings that aren't queued or running (completed, stopped, failed), in the Jobs
// explorer. The GPU queues are on the Queue page (/jobs).
import JobsTable from '@/components/JobsTable';
import { TopBar, MainContent } from '@/components/layout';
import Link from 'next/link';

export default function Trainings() {
  return (
    <>
      <TopBar>
        <div>
          <h1 className="text-base sm:text-lg">Trainings</h1>
        </div>
        <div className="flex-1"></div>
        <div>
          <Link
            href="/jobs/new"
            className="text-white bg-slate-600 px-2 sm:px-3 py-1 rounded-md text-sm sm:text-base whitespace-nowrap"
          >
            <span className="sm:hidden">+ New Job</span>
            <span className="hidden sm:inline">New Training Job</span>
          </Link>
        </div>
      </TopBar>
      {/* the page doesn't scroll; the list scrolls in its own card */}
      <MainContent className="overflow-hidden">
        <JobsTable view="trainings" />
      </MainContent>
    </>
  );
}
