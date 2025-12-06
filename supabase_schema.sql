-- AI新闻资讯表
CREATE TABLE IF NOT EXISTS aibase_news (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,                    -- 标题
  summary TEXT,                           -- 摘要
  published_at TIMESTAMP WITH TIME ZONE,  -- 发布时间
  view_count INTEGER DEFAULT 0,          -- 观看次数
  url TEXT NOT NULL UNIQUE,              -- 访问地址（唯一约束，避免重复）
  is_podcast BOOLEAN DEFAULT FALSE,      -- 是否已制作成播客
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),  -- 创建时间
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()   -- 更新时间
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_aibase_news_url ON aibase_news(url);
CREATE INDEX IF NOT EXISTS idx_aibase_news_published_at ON aibase_news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_aibase_news_is_podcast ON aibase_news(is_podcast);
CREATE INDEX IF NOT EXISTS idx_aibase_news_created_at ON aibase_news(created_at DESC);

-- 创建更新时间自动更新的触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_aibase_news_updated_at
  BEFORE UPDATE ON aibase_news
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 添加注释
COMMENT ON TABLE aibase_news IS 'AIBase新闻资讯表';
COMMENT ON COLUMN aibase_news.title IS '新闻标题';
COMMENT ON COLUMN aibase_news.summary IS '新闻摘要';
COMMENT ON COLUMN aibase_news.published_at IS '发布时间';
COMMENT ON COLUMN aibase_news.view_count IS '观看次数';
COMMENT ON COLUMN aibase_news.url IS '新闻访问地址（唯一）';
COMMENT ON COLUMN aibase_news.is_podcast IS '是否已制作成播客';

