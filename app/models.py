
from sqlalchemy import (
    String,
    Integer,
    Numeric,
    DateTime,
    ForeignKey,
    CheckConstraint,
    UniqueConstraint
)

from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship
)


# Clase base para los modelos ORM
class Base(DeclarativeBase):
    pass

class Ubicacion(Base):

    __tablename__ = "ubicaciones"

    id_ubicacion: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True
    )

    nombre: Mapped[str] = mapped_column(
        String(50),
        nullable=False
    )

    latitud: Mapped[float] = mapped_column(
        Numeric(9, 6),
        nullable=False
    )

    longitud: Mapped[float] = mapped_column(
        Numeric(9, 6),
        nullable=False
    )

    timezone: Mapped[str] = mapped_column(
        String(50),
        nullable=False
    )

    pronosticos: Mapped[list["Pronostico"]] = relationship(
        back_populates="ubicacion"
    )

    __table_args__ = (
        CheckConstraint(
            "latitud BETWEEN -90 AND 90",
            name="ck_lat"
        ),
        CheckConstraint(
            "longitud BETWEEN -180 AND 180",
            name="ck_lon"
        )
    )



class Pronostico(Base):

    __tablename__ = "pronosticos"

    id_arrebol: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True
    )

    id_ubicacion: Mapped[int] = mapped_column(
        ForeignKey(
            "ubicaciones.id_ubicacion",
            name="fk_ubicacion_arrebol",
            onupdate="CASCADE",
            ondelete="CASCADE"
        ),
        nullable=False
    )

    fecha_hora: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )

    tipo_arrebol: Mapped[int] = mapped_column(
        Integer,
        nullable=False
    )

    prob: Mapped[float] = mapped_column(
        Numeric(4, 3),
        nullable=False
    )

    ubicacion: Mapped["Ubicacion"] = relationship(
        back_populates="pronosticos"
    )

    __table_args__ = (
        UniqueConstraint(
            "id_ubicacion",
            "fecha_hora"
        ),
        CheckConstraint(
            "prob >= 0 AND prob <= 1",
            name="ck_proba_arrebol"
        )
    )