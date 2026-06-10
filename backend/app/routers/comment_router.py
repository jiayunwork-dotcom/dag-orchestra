import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Comment, User
from app.schemas import CommentCreate, CommentOut

router = APIRouter(prefix="/comments", tags=["comments"])


@router.get("/{dag_id}", response_model=list[CommentOut])
async def list_comments(dag_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Comment).where(Comment.dag_id == dag_id).order_by(Comment.created_at.desc())
    )
    return result.scalars().all()


@router.post("/{dag_id}", response_model=CommentOut, status_code=201)
async def create_comment(
    dag_id: str,
    body: CommentCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    comment = Comment(
        id=str(uuid.uuid4()),
        dag_id=dag_id,
        target_type=body.target_type,
        target_id=body.target_id,
        content=body.content,
        author_id=user.id,
        mention_ids=body.mention_ids,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return comment


@router.put("/{comment_id}", response_model=CommentOut)
async def update_comment(
    comment_id: str,
    body: CommentCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Comment).where(Comment.id == comment_id))
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.author_id != user.id:
        raise HTTPException(status_code=403, detail="Can only edit own comments")
    comment.content = body.content
    comment.mention_ids = body.mention_ids
    comment.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(comment)
    return comment


@router.delete("/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Comment).where(Comment.id == comment_id))
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.author_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Cannot delete this comment")
    await db.delete(comment)
    await db.commit()
