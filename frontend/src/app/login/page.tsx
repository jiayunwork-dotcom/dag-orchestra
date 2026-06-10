'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const router = useRouter();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isRegister) {
        await authApi.register({ username, email, password, role: 'editor' });
        toast.success('注册成功，请登录');
        setIsRegister(false);
      } else {
        const res = await authApi.login({ username, password });
        localStorage.setItem('token', res.data.access_token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        toast.success('登录成功');
        router.push('/dashboard');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '操作失败');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0f172a]">
      <div className="w-full max-w-md p-8 bg-[#1e293b] rounded-xl shadow-2xl border border-slate-700">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-blue-400">DAG Orchestra</h1>
          <p className="text-slate-400 mt-2">实时数据流编排与运行监控平台</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-4 py-2 bg-[#0f172a] border border-slate-600 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          {isRegister && (
            <div>
              <label className="block text-sm text-slate-300 mb-1">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2 bg-[#0f172a] border border-slate-600 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-sm text-slate-300 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-2 bg-[#0f172a] border border-slate-600 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
          >
            {isRegister ? '注册' : '登录'}
          </button>
        </form>

        <div className="text-center mt-6">
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            {isRegister ? '已有账号？去登录' : '没有账号？去注册'}
          </button>
        </div>
      </div>
    </div>
  );
}
