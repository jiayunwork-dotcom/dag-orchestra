'use client';

import { useEffect, useState } from 'react';
import { commentApi, authApi } from '@/lib/api';
import { Comment, UserInfo } from '@/types';
import toast from 'react-hot-toast';

interface CommentPanelProps {
  dagId: string;
  onClose: () => void;
}

export default function CommentPanel({ dagId, onClose }: CommentPanelProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [newComment, setNewComment] = useState('');
  const [targetType, setTargetType] = useState('node');
  const [targetId, setTargetId] = useState('');
  const [mentionInput, setMentionInput] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);

  useEffect(() => {
    loadData();
  }, [dagId]);

  const loadData = async () => {
    try {
      const [cRes, uRes] = await Promise.all([commentApi.list(dagId), authApi.getUsers()]);
      setComments(cRes.data);
      setUsers(uRes.data);
    } catch {}
  };

  const handleCreate = async () => {
    if (!newComment.trim() || !targetId.trim()) return;
    try {
      await commentApi.create(dagId, {
        target_type: targetType,
        target_id: targetId,
        content: newComment,
        mention_ids: mentions,
      });
      setNewComment('');
      setMentions([]);
      setMentionInput('');
      loadData();
      toast.success('评论已添加');
    } catch {
      toast.error('添加评论失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await commentApi.delete(id);
      loadData();
    } catch {}
  };

  const addMention = (userId: string) => {
    if (!mentions.includes(userId)) {
      setMentions([...mentions, userId]);
    }
    setMentionInput('');
  };

  const getUsername = (userId: string) => {
    return users.find(u => u.id === userId)?.username || userId;
  };

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-[#1e293b] border-l border-slate-700 z-50 overflow-y-auto shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <h3 className="font-semibold">评论</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
      </div>

      <div className="p-4">
        <div className="space-y-3 mb-6">
          <div className="flex gap-2">
            <select value={targetType} onChange={e => setTargetType(e.target.value)}
              className="px-2 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-xs text-slate-100">
              <option value="node">节点</option>
              <option value="edge">连线</option>
            </select>
            <input placeholder="目标ID" value={targetId}
              onChange={e => setTargetId(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-xs text-slate-100" />
          </div>

          <textarea
            placeholder="写评论... 使用 @ 提及成员"
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 h-20 resize-none"
          />

          <div>
            <input placeholder="@提及成员" value={mentionInput}
              onChange={e => setMentionInput(e.target.value)}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-xs text-slate-100 mb-1" />
            {mentionInput && (
              <div className="bg-[#0f172a] border border-slate-600 rounded mt-1 max-h-24 overflow-y-auto">
                {users.filter(u => u.username.includes(mentionInput)).map(u => (
                  <button key={u.id} onClick={() => addMention(u.id)}
                    className="w-full text-left px-3 py-1 text-xs text-slate-300 hover:bg-slate-700">
                    {u.username}
                  </button>
                ))}
              </div>
            )}
            {mentions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {mentions.map(uid => (
                  <span key={uid} className="px-2 py-0.5 bg-blue-900/50 text-blue-300 text-xs rounded">
                    @{getUsername(uid)}
                    <button onClick={() => setMentions(mentions.filter(m => m !== uid))} className="ml-1">✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleCreate} className="w-full py-2 text-sm bg-blue-600 hover:bg-blue-700 rounded">
            发表评论
          </button>
        </div>

        <div className="space-y-3">
          {comments.map(c => (
            <div key={c.id} className="p-3 bg-[#0f172a] border border-slate-600 rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
                    style={{ backgroundColor: users.find(u => u.id === c.author_id)?.avatar_color || '#4A90D9' }}>
                    {getUsername(c.author_id).charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs font-medium">{getUsername(c.author_id)}</span>
                </div>
                <span className="text-xs text-slate-500">{new Date(c.created_at).toLocaleString('zh-CN')}</span>
              </div>
              <div className="text-sm text-slate-300">{c.content}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-slate-500">目标: {c.target_type} {c.target_id}</span>
                {c.mention_ids?.length > 0 && (
                  <span className="text-xs text-blue-400">
                    {c.mention_ids.map(m => `@${getUsername(m)}`).join(' ')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
