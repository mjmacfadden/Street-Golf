import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, ChevronLeft, AlertTriangle, Loader, Download, ChevronDown } from 'lucide-react';
import {
  getAllCourses,
  getAllUsers,
  deleteUserAndData,
  deleteCourseAdmin,
  migrateCourseToFirebase,
  type Course,
  type AdminUser,
} from '../utils/courseService';
import { COURSES } from '../constants/course';

interface AdminPanelProps {
  onClose: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ onClose }) => {
  const [view, setView] = useState<'overview' | 'users' | 'courses'>('overview');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'user' | 'course'; id: string; name: string } | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedUsers, fetchedCourses] = await Promise.all([getAllUsers(), getAllCourses()]);
      setUsers(fetchedUsers);
      setCourses(fetchedCourses);
      
      // Check if we got permission errors
      if (fetchedUsers.length === 0 && fetchedCourses.length === 0) {
        setError('Unable to load admin data. This requires admin permissions in Firestore. Check browser console for details.');
      }
    } catch (err: any) {
      console.error('Failed to load admin data:', err);
      setError(`Error: ${err.message || 'Failed to load admin data'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setDeleting(userId);
    try {
      await deleteUserAndData(userId);
      setUsers(users.filter(u => u.uid !== userId));
      setCourses(courses.filter(c => c.userId !== userId));
      setConfirmDelete(null);
    } catch (error) {
      console.error('Failed to delete user:', error);
      alert('Failed to delete user');
    } finally {
      setDeleting(null);
    }
  };

  const handleDeleteCourse = async (courseId: string) => {
    setDeleting(courseId);
    try {
      await deleteCourseAdmin(courseId);
      setCourses(courses.filter(c => c.id !== courseId));
      setConfirmDelete(null);
    } catch (error) {
      console.error('Failed to delete course:', error);
      alert('Failed to delete course');
    } finally {
      setDeleting(null);
    }
  };

  const exportToCSV = () => {
    // Prepare data for CSV
    const csvRows = [
      ['User Email', 'User Name', 'User UID', 'Course Name', 'Holes', 'Status', 'Created Date'],
    ];

    // Add user and course data
    users.forEach(user => {
      const userCourses = courses.filter(c => c.userId === user.uid);
      if (userCourses.length > 0) {
        userCourses.forEach((course, idx) => {
          csvRows.push([
            user.email || '',
            user.displayName || '',
            user.uid,
            course.courseName,
            String(course.holes.length),
            course.status || 'draft',
            course.createdAt?.toLocaleDateString?.() || '',
          ]);
        });
      } else {
        // Show user even if they have no courses
        csvRows.push([user.email || '', user.displayName || '', user.uid, '', '', '', '']);
      }
    });

    // Convert to CSV string
    const csvContent = csvRows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users-courses-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleMigrateCourses = async () => {
    const adminUid = 'NboBOK41rVcAEcs6nhRmrALQ0KC2';
    setMigrating(true);
    setError(null);
    
    try {
      // Migrate each hardcoded course
      for (const course of COURSES) {
        await migrateCourseToFirebase(
          adminUid,
          course.id,
          course.name,
          course.location,
          course.holes
        );
      }
      
      alert('✅ Successfully migrated Southbridge and Glenbrook courses to Firebase!');
      // Reload courses
      await loadData();
    } catch (err: any) {
      console.error('Migration failed:', err);
      setError(`Migration failed: ${err.message}`);
      alert(`❌ Migration failed: ${err.message}`);
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 pb-32 bg-white">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 transition-colors mb-4 font-bold"
          >
            <ChevronLeft size={20} />
            Back to Profile
          </button>
          <h1 className="text-4xl font-black text-gray-900 uppercase italic">Admin Panel</h1>
          <p className="text-gray-600 mt-2">Manage users and courses</p>
        </motion.div>

        {/* Error Message */}
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-red-100 border border-red-300 rounded-lg text-red-800 text-sm"
          >
            <p className="font-bold mb-1">⚠️ Permission Error</p>
            <p>{error}</p>
          </motion.div>
        )}

        {/* Navigation */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 mb-8">
          <button
            onClick={() => setView('overview')}
            className={`px-4 py-2 rounded-lg font-bold transition-colors ${
              view === 'overview'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setView('users')}
            className={`px-4 py-2 rounded-lg font-bold transition-colors ${
              view === 'users'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
            }`}
          >
            Users ({users.length})
          </button>
          <button
            onClick={() => setView('courses')}
            className={`px-4 py-2 rounded-lg font-bold transition-colors ${
              view === 'courses'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
            }`}
          >
            Courses ({courses.length})
          </button>
        </motion.div>

        {/* Overview View */}
        {view === 'overview' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-100 border border-blue-300 rounded-2xl p-6">
                <div className="text-4xl font-black text-blue-700 mb-2">{users.length}</div>
                <div className="text-gray-700">Total Users</div>
              </div>
              <div className="bg-green-100 border border-green-300 rounded-2xl p-6">
                <div className="text-4xl font-black text-green-700 mb-2">{courses.length}</div>
                <div className="text-gray-700">Total Courses</div>
              </div>
            </div>
            <button
              onClick={loadData}
              disabled={loading}
              className="w-full py-2 px-4 bg-blue-100 hover:bg-blue-200 text-blue-700 font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh Data'}
            </button>
            <button
              onClick={handleMigrateCourses}
              disabled={migrating}
              className="w-full py-2 px-4 bg-purple-100 hover:bg-purple-200 text-purple-700 font-bold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {migrating ? (
                <>
                  <Loader size={18} className="animate-spin" />
                  Migrating Courses...
                </>
              ) : (
                'Migrate Hardcoded Courses to Firebase'
              )}
            </button>
          </motion.div>
        )}

        {/* Users View */}
        {view === 'users' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-900">Users & Courses</h2>
              <button
                onClick={exportToCSV}
                disabled={loading || users.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Export all users and courses to CSV"
              >
                <Download size={18} />
                Export CSV
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <Loader className="animate-spin text-blue-600" size={32} />
              </div>
            ) : users.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No users found</div>
            ) : (
              users.map(user => {
                const userCourses = courses.filter(c => c.userId === user.uid);
                const isExpanded = expandedUser === user.uid;
                return (
                  <motion.div
                    key={user.uid}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-gray-50 border border-gray-300 rounded-2xl overflow-hidden"
                  >
                    <div
                      onClick={() => setExpandedUser(isExpanded ? null : user.uid)}
                      className="p-4 hover:bg-gray-100 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <ChevronDown
                            size={20}
                            className={`text-gray-600 transition-transform flex-shrink-0 ${
                              isExpanded ? 'rotate-180' : ''
                            }`}
                          />
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-gray-900 truncate">{user.displayName || 'Unknown'}</h3>
                            <p className="text-xs text-gray-600 truncate">{user.email}</p>
                            <div className="flex gap-4 mt-2 text-xs text-gray-600">
                              <span>UID: {user.uid.slice(0, 12)}...</span>
                              <span className="font-semibold text-blue-600">
                                {user.courseCount} course{user.courseCount !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setConfirmDelete({
                              type: 'user',
                              id: user.uid,
                              name: user.displayName || user.email || 'User',
                            });
                          }}
                          disabled={deleting === user.uid}
                          className="p-2 hover:bg-red-200 text-red-600 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                          title="Delete user and all data"
                        >
                          {deleting === user.uid ? <Loader size={18} className="animate-spin" /> : <Trash2 size={18} />}
                        </button>
                      </div>
                    </div>

                    {/* Expanded courses list */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="border-t border-gray-300 bg-white"
                        >
                          {userCourses.length === 0 ? (
                            <div className="p-4 text-center text-gray-500 text-sm">No courses</div>
                          ) : (
                            <div className="divide-y divide-gray-200">
                              {userCourses.map(course => (
                                <div key={course.id} className="p-4 hover:bg-gray-50 transition-colors">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                      <h4 className="font-semibold text-gray-900 truncate">{course.courseName}</h4>
                                      <div className="flex gap-4 mt-1 text-xs text-gray-600">
                                        <span>{course.holes.length} holes</span>
                                        <span
                                          className={
                                            course.status === 'published'
                                              ? 'text-green-600 font-semibold'
                                              : 'text-gray-600'
                                          }
                                        >
                                          {course.status || 'draft'}
                                        </span>
                                        <span>{course.createdAt?.toLocaleDateString?.()}</span>
                                      </div>
                                    </div>
                                    <button
                                      onClick={() =>
                                        setConfirmDelete({
                                          type: 'course',
                                          id: course.id,
                                          name: course.courseName,
                                        })
                                      }
                                      disabled={deleting === course.id}
                                      className="p-2 hover:bg-red-200 text-red-600 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                                      title="Delete course"
                                    >
                                      {deleting === course.id ? (
                                        <Loader size={16} className="animate-spin" />
                                      ) : (
                                        <Trash2 size={16} />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })
            )}
          </motion.div>
        )}

        {/* Courses View */}
        {view === 'courses' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader className="animate-spin text-blue-600" size={32} />
              </div>
            ) : courses.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No courses found</div>
            ) : (
              courses.map(course => (
                <motion.div
                  key={course.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-gray-50 border border-gray-300 rounded-2xl p-4 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-gray-900 truncate">{course.courseName}</h3>
                      <div className="flex gap-4 mt-2 text-xs text-gray-600">
                        <span>{course.holes.length} holes</span>
                        <span className={course.status === 'published' ? 'text-blue-600 font-semibold' : 'text-gray-600'}>
                          {course.status}
                        </span>
                        <span className="text-gray-600">{course.createdAt?.toLocaleDateString?.()}</span>
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        setConfirmDelete({
                          type: 'course',
                          id: course.id,
                          name: course.courseName,
                        })
                      }
                      disabled={deleting === course.id}
                      className="p-2 hover:bg-red-200 text-red-600 rounded-lg transition-colors disabled:opacity-50"
                      title="Delete course"
                    >
                      {deleting === course.id ? <Loader size={18} className="animate-spin" /> : <Trash2 size={18} />}
                    </button>
                  </div>
                </motion.div>
              ))
            )}
          </motion.div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
            onClick={() => setConfirmDelete(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-red-300 rounded-3xl p-6 max-w-md w-full"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start gap-4 mb-4">
                <AlertTriangle className="text-red-600 flex-shrink-0 mt-1" size={24} />
                <div>
                  <h3 className="text-xl font-black text-gray-900 mb-2">Confirm Delete</h3>
                  <p className="text-gray-700 text-sm">
                    Delete {confirmDelete.type === 'user' ? 'user' : 'course'}:{' '}
                    <span className="font-bold text-red-600">{confirmDelete.name}</span>?
                  </p>
                  {confirmDelete.type === 'user' && (
                    <p className="text-xs text-red-600 mt-3">⚠️ This will delete all their courses, rounds, and favorites!</p>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-900 font-bold rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (confirmDelete.type === 'user') {
                      handleDeleteUser(confirmDelete.id);
                    } else {
                      handleDeleteCourse(confirmDelete.id);
                    }
                  }}
                  disabled={deleting !== null}
                  className="flex-1 py-2 px-4 bg-red-200 hover:bg-red-300 text-red-700 font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
