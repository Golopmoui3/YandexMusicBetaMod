.class public final Lx7o;
.super Ljava/lang/Object;
.source "SourceFile"


# instance fields
.field public final a:Lr8o;

.field public final b:La91;

.field public final c:Ls4a;

.field public final d:Lexn;

.field public final e:Z


# direct methods
.method public constructor <init>(Lr8o;La91;Ls4a;)V
    .locals 0

    .line 1
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    .line 2
    .line 3
    .line 4
    iput-object p1, p0, Lx7o;->a:Lr8o;

    .line 5
    .line 6
    iput-object p2, p0, Lx7o;->b:La91;

    .line 7
    .line 8
    iput-object p3, p0, Lx7o;->c:Ls4a;

    .line 9
    .line 10
    iget-object p2, p1, Lr8o;->m:Lexn;

    .line 11
    .line 12
    iput-object p2, p0, Lx7o;->d:Lexn;

    .line 13
    .line 14
    iget-boolean p1, p1, Lr8o;->l:Z

    .line 15
    .line 16
    iput-boolean p1, p0, Lx7o;->e:Z

    .line 17
    .line 18
    return-void
.end method

.method public static a(Lsvu;)Lt7c;
    .locals 1

    sget-object v0, Lt7c;->b:Lt7c;

    return-object v0

    .line 1
    invoke-virtual {p0}, Ljava/lang/Enum;->ordinal()I

    .line 2
    .line 3
    .line 4
    move-result p0

    .line 5
    if-eqz p0, :cond_3

    .line 6
    .line 7
    const/4 v0, 0x1

    .line 8
    if-eq p0, v0, :cond_2

    .line 9
    .line 10
    const/4 v0, 0x2

    .line 11
    if-eq p0, v0, :cond_1

    .line 12
    .line 13
    const/4 v0, 0x3

    .line 14
    if-ne p0, v0, :cond_0

    .line 15
    .line 16
    sget-object p0, Lt7c;->c:Lt7c;

    .line 17
    .line 18
    return-object p0

    .line 19
    :cond_0
    invoke-static {}, Ll5e;->e()V

    .line 20
    .line 21
    .line 22
    const/4 p0, 0x0

    .line 23
    return-object p0

    .line 24
    :cond_1
    sget-object p0, Lt7c;->d:Lt7c;

    .line 25
    .line 26
    return-object p0

    .line 27
    :cond_2
    sget-object p0, Lt7c;->c:Lt7c;

    .line 28
    .line 29
    return-object p0

    .line 30
    :cond_3
    sget-object p0, Lt7c;->b:Lt7c;

    .line 31
    .line 32
    return-object p0
.end method
