.class public final Lz7o;
.super Ljava/lang/Object;
.source "SourceFile"


# instance fields
.field public final a:Le7c;

.field public final b:Lp8t;


# direct methods
.method public constructor <init>(Le7c;)V
    .locals 1

    .line 1
    invoke-virtual {p1}, Ljava/lang/Object;->getClass()Ljava/lang/Class;

    .line 2
    .line 3
    .line 4
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    .line 5
    .line 6
    .line 7
    iput-object p1, p0, Lz7o;->a:Le7c;

    .line 8
    .line 9
    new-instance p1, Lbfn;

    .line 10
    .line 11
    const/16 v0, 0xa

    .line 12
    .line 13
    invoke-direct {p1, v0}, Lbfn;-><init>(I)V

    .line 14
    .line 15
    .line 16
    invoke-static {p1}, Lvgg;->b(Lkotlin/jvm/functions/Function0;)Lp8t;

    .line 17
    .line 18
    .line 19
    move-result-object p1

    .line 20
    iput-object p1, p0, Lz7o;->b:Lp8t;

    .line 21
    .line 22
    return-void
.end method

.method public static a(Lt7o;)Lt7c;
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
    sget-object p0, Lt7c;->b:Lt7c;

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
    sget-object p0, Lt7c;->d:Lt7c;

    .line 31
    .line 32
    return-object p0
.end method
