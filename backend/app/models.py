import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Text, Integer, Float, Boolean, DateTime, ForeignKey, JSON, Enum, Index
)
from sqlalchemy.orm import relationship

from app.database import Base


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"


class DAGStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    RUNNING = "running"
    STOPPED = "stopped"
    GRAYSCALE = "grayscale"


class AlertSeverity(str, enum.Enum):
    WARNING = "warning"
    CRITICAL = "critical"


class AlertStatus(str, enum.Enum):
    ACTIVE = "active"
    SILENCED = "silenced"
    RESOLVED = "resolved"


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(100), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.VIEWER)
    avatar_color = Column(String(7), default="#4A90D9")
    created_at = Column(DateTime, default=datetime.utcnow)


class DAG(Base):
    __tablename__ = "dags"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(200), nullable=False)
    description = Column(Text, default="")
    status = Column(Enum(DAGStatus), default=DAGStatus.DRAFT)
    grayscale_ratio = Column(Integer, default=0)
    owner_id = Column(String, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    versions = relationship("DAGVersion", back_populates="dag", order_by="DAGVersion.version_number")
    alerts = relationship("AlertRule", back_populates="dag")
    permissions = relationship("DAGPermission", back_populates="dag")
    comments = relationship("Comment", back_populates="dag")


class DAGVersion(Base):
    __tablename__ = "dag_versions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    dag_id = Column(String, ForeignKey("dags.id"), nullable=False)
    version_number = Column(Integer, nullable=False)
    nodes = Column(JSON, default=list)
    edges = Column(JSON, default=list)
    is_archived = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String, ForeignKey("users.id"))

    dag = relationship("DAG", back_populates="versions")

    __table_args__ = (Index("ix_dag_version", "dag_id", "version_number", unique=True),)


class DAGPermission(Base):
    __tablename__ = "dag_permissions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    dag_id = Column(String, ForeignKey("dags.id"), nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    can_edit = Column(Boolean, default=False)

    dag = relationship("DAG", back_populates="permissions")

    __table_args__ = (Index("ix_dag_perm", "dag_id", "user_id", unique=True),)


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    dag_id = Column(String, ForeignKey("dags.id"), nullable=False)
    name = Column(String(200), nullable=False)
    metric_type = Column(String(50), nullable=False)
    node_id = Column(String, nullable=True)
    condition = Column(String(20), nullable=False)
    threshold = Column(Float, nullable=False)
    duration_seconds = Column(Integer, default=0)
    severity = Column(Enum(AlertSeverity), default=AlertSeverity.WARNING)
    enabled = Column(Boolean, default=True)
    silence_start = Column(String(5), nullable=True)
    silence_end = Column(String(5), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    dag = relationship("DAG", back_populates="alerts")


class AlertHistory(Base):
    __tablename__ = "alert_history"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    alert_rule_id = Column(String, ForeignKey("alert_rules.id"), nullable=False)
    dag_id = Column(String, ForeignKey("dags.id"), nullable=False)
    current_value = Column(Float, nullable=False)
    duration_seconds = Column(Integer, default=0)
    status = Column(Enum(AlertStatus), default=AlertStatus.ACTIVE)
    triggered_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)


class Comment(Base):
    __tablename__ = "comments"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    dag_id = Column(String, ForeignKey("dags.id"), nullable=False)
    target_type = Column(String(20), nullable=False)
    target_id = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    author_id = Column(String, ForeignKey("users.id"), nullable=False)
    mention_ids = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    dag = relationship("DAG", back_populates="comments")


class Checkpoint(Base):
    __tablename__ = "checkpoints"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    dag_id = Column(String, ForeignKey("dags.id"), nullable=False)
    state_data = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (Index("ix_checkpoint_dag", "dag_id", "created_at"),)
