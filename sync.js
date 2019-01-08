const EVENT_TYPES = {
    CREATE_OBJECT:'CREATE_OBJECT',
    DELETE_OBJECT:'DELETE_OBJECT',
    CREATE_PROPERTY:'CREATE_PROPERTY',
    SET_PROPERTY:'SET_PROPERTY',
    DELETE_PROPERTY:'DELETE_PROPERTY',

    CREATE_ARRAY:'CREATE_ARRAY',
    INSERT_ELEMENT:'INSERT_ELEMENT',
    DELETE_ELEMENT:'DELETE_ELEMENT',
    DELETE_ARRAY:'DELETE_ARRAY',
}

class ObjectSyncProtocol {
    constructor(settings) {
        settings = settings || {}
        this.objs = {}
        this.listeners = []
        this.host = settings.host || this.makeGUID()
        this.waitBuffer = []
    }
    makeGUID() {
        return Math.floor(Math.random()*100000000) + ""
    }

    isValidOperation(op) {
        if(op.type === EVENT_TYPES.CREATE_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return false
        }
        return true
    }

    retryWaitBuffer() {
        let i = 0
        while(i < this.waitBuffer.length) {
            const op = this.waitBuffer[i]
            if(this.isValidOperation(op)) {
                console.log("re-trying op",op)
                this.process(op)
                this.waitBuffer.splice(i,1)
            }
            i++
        }
    }
    process(op) {
        console.log(`${this.getHostId()}:processing op`,op)

        if(!this.isValidOperation(op)) {
            console.log("the operation is not valid. might be in the future")
            this.waitBuffer.push(op)
            return
        }

        if(op.type === EVENT_TYPES.CREATE_OBJECT) {
            const obj = {
                _id:op.id,
                _type:'object',
            }
            if(this.objs[obj._id]) {
                console.log(`object ${obj._id} already exists. don't fire or change`)
                return obj._id
            }
            this.objs[obj._id] = obj

            this.fire(op)
            this.retryWaitBuffer()
            return obj._id
        }
        if(op.type === EVENT_TYPES.CREATE_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return console.error(`Cannot create property ${op.name} on object ${op.object} that does not exist`)
            if(obj[op.name]) return console.log("property already exists. don't fire or change")
            obj[op.name] = op.value
            this.fire(op)
            return
        }
        if(op.type === EVENT_TYPES.SET_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return console.error(`Cannot set property ${op.name} on object ${op.object} that does not exist`)
            if(obj[op.name] === op.value) return console.log("property already has this value, don't fire or change")
            obj[op.name] = op.value
            this.fire(op)
            return
        }
        if(op.type === EVENT_TYPES.DELETE_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return console.error(`cannot delete property on object ${ob.object} that does not exist`)
            if(!obj.hasOwnProperty(op.name)) return console.error(`object doesn't have the property ${op.name}`)
            delete obj[op.name]
            this.fire(op)
            return
        }
        if(op.type === EVENT_TYPES.DELETE_OBJECT) {
            const obj = this.getObjectById(op.id)
            if(!obj) return console.error(`no such object exists with id ${op.id}`)
            delete this.objs[obj._id]
            this.fire(op)
            return
        }

        console.log(`CANNOT process operation of type ${op.type}`)
    }
    createObject(objid) {
        const obj = {
            _id:objid?objid:this.makeGUID(),
            _type:'object',
        }
        if(this.objs[obj._id]) {
            //console.log(`object ${obj._id} already exists. don't fire or change`)
            return obj._id
        }
        this.objs[obj._id] = obj
        this.fire({type:EVENT_TYPES.CREATE_OBJECT,id:obj._id, host:this.host})
        return obj._id
    }
    deleteObject(objid) {
        const obj = this.getObjectById(objid)
        if(!obj) {
            console.error("no such object exists with id",objid)
            return
        }
        delete this.objs[obj._id]
        this.fire({type:EVENT_TYPES.DELETE_OBJECT,id:obj._id, host:this.host})
    }
    getObjectById(objid) {
        return this.objs[objid]
    }



    createArray(arrid) {
        const arr = {
            _id:arrid?arrid:makeGUID(),
            _type:'array',
            _elements:[]
        }
        if(this.objs[arr._id]) {
            console.log("array already exists. don't fire or change")
            return arr._id
        }
        this.objs[arr._id] = arr
        this.fire({type:EVENT_TYPES.CREATE_ARRAY,id:arr._id, host:this.host })
        return arr._id
    }

    insertElement(arrid, index, elementid) {
        // console.log('inserting at', index, 'value', elementid)
        const arr = this.getObjectById(arrid)
        if (!arr) return console.error(`Cannot insert element into ${arrid} that does not exist`);

        // const current = arr._elements[index]
        let prev = -1
        if (index > 0) {
            prev = arr._elements[index - 1]._id
        }
        this.insertElementDirect(arrid, prev, elementid,null, Date.now())
    }

    insertElementDirect(arrid, prev, value, entryid, timestamp) {
        const arr = this.getObjectById(arrid)
        if (!arr) return console.error(`Cannot insert element into ${arrid} that does not exist`);
        //check if already in there. id p entryid and prev is the same
        if(arr._elements.some(e=>e._id === entryid && e._prev === prev)) {
            console.log("already processed this insertion. don't fire or change")
            return entryid
        }

        //console.log("inserting",value,'after',prev,'into',arr,'with id',entryid)

        const elem = {
            _id:entryid?entryid:this.makeGUID(),
            _value:value,
            _prev:prev,
            _timestamp:timestamp,
            _tombstone:false
        }
        //calculate the index of the prev
        const index = arr._elements.findIndex(e => e._id === prev)

        const curr = arr._elements[index+1]
        //two forms of insert
        if(curr && curr._prev === prev) {
            // console.log(this.id, "must decide", elem._id, elem._timestamp, curr._id, curr._timestamp)
            if(elem._timestamp > curr._timestamp) {
                // console.log('new elem first')
                arr._elements.splice(index+1,0,elem)
            } else if(elem._timestamp < curr._timestamp) {
                // console.log("new elem second")
                arr._elements.splice(index+2,0,elem)
            } else {
                // console.log("same time. go with earliest id")
                if(elem._id > curr._id) {
                    // console.log('first')
                    arr._elements.splice(index+1,0,elem)
                } else {
                    // console.log("second")
                    arr._elements.splice(index+2,0,elem)
                }
            }

        } else {
            arr._elements.splice(index+1,0,elem)
        }
        // console.log(this.id, "final array is",arr)
        this.fire({
            type:EVENT_TYPES.INSERT_ELEMENT,
            object:arrid,
            after:prev,
            value:value,
            entry:elem._id,
            host:this.host,
            timestamp:Date.now(),
        })
    }

    removeElement(arrid, index) {
        const arr = this.getObjectById(arrid)
        if (!arr) return console.error(`Cannot insert element into ${arrid} that does not exist`);
        const elem = arr._elements[index]
        elem._tombstone = true
        this.fire({
            type:EVENT_TYPES.DELETE_ELEMENT,
            host:this.host,
            object:arrid,
            entry:elem._id,
            timestamp: Date.now()
        })
    }
    getArrayLength(arrid) {
        const arr = this.getObjectById(arrid)
        if (!arr) return console.error(`Cannot get array length for array ${arrid} that does not exist`);
        let len = 0
        arr._elements.forEach(el => {
            if(el._tombstone === false) len++
        })
        return len
    }
    getElementAt(arrid,index) {
        const arr = this.getObjectById(arrid)
        if (!arr) return console.error(`Cannot get element from array ${arrid} that does not exist`);
        const elem = arr._elements[index]
        return elem._value
    }

    createProperty(objid, name, value) {
        const obj = this.getObjectById(objid)
        if(!obj) return console.error(`Cannot set property ${name} on object ${objid} that does not exist`)
        if(obj[name]) {
            // console.log("property already exists. don't fire or change")
            return
        }
        obj[name] = value
        this.fire({
            type:EVENT_TYPES.CREATE_PROPERTY,
            host:this.host,
            object:objid,
            name:name,
            value:value
        })
    }
    setProperty(objid,name,value,original) {
        if(original && original.host === this.host) {
            console.log("this is our own. don't recurse")
            return;
        }
        const obj = this.getObjectById(objid)
        if(!obj) return console.error("cannot set property on object that does not exist")
        if(obj[name] === value) {
            console.log("property already has this value, don't fire or change")
            return
        }
        obj[name] = value
        this.fire({
            type:EVENT_TYPES.SET_PROPERTY,
            host:this.host,
            object:objid,
            name:name,
            value:value
        })
    }

    getHostId() {
        return this.host
    }

    applyCommand(cmd) {
        if(cmd.type === EVENT_TYPES.SET_PROPERTY) {
            console.log("doing new form of set property")
        }
    }
    deleteProperty(objid,name) {
        const obj = this.getObjectById(objid)
        if(!obj) return console.error("cannot delete property on object that does not exist")
        if(!obj.hasOwnProperty(name)) return console.error(`object doesn't have the property ${name}`)
        delete obj[name]
        this.fire({
            type:EVENT_TYPES.DELETE_PROPERTY,
            object:objid,
            name:name,
        })
    }

    onChange(cb) {
        this.listeners.push(cb)
    }
    fire(event) {
        this.listeners.forEach(cb => cb(event))
    }

    getObjectByProperty(key,value) {
        for(let id in this.objs) {
            const obj = this.objs[id]
            // console.log('obj',id,':',obj)
            // console.log("checking",key,value)
            if(obj[key] === value) return obj._id
        }
        return null
    }

    getPropertiesForObject(objid) {
        const obj = this.getObjectById(objid)
        if(!obj) return console.error("cannot get properties for object that does not exist not exist")
        return Object.keys(obj)
            .filter(key => key !== '_id')
            .filter(key => key !== '_type')
    }
    getPropertyValue(objid, key) {
        const obj = this.getObjectById(objid)
        if(!obj) return console.error("cannot get properties for object that does not exist not exist")
        return obj[key]
    }
    hasPropertyValue(objid,key) {
        return this.getObjectById(objid).hasOwnProperty(key)
    }

    dumpGraph() {
        const graph = {}
        Object.keys(this.objs).forEach(key => {
            const obj = this.objs[key]
            let id = obj._id
            if(obj.id) id = obj.id
            graph[id] = {}

            if(obj._type === 'array'){
                graph[id] = []
                obj._elements.forEach((el=>{
                    // console.log("looking at element",el)
                    if(el._tombstone === false) graph[id].push(el._value)
                }))
                return;
            }

            Object.keys(obj).forEach(key => {
                if(key === '_id' && obj.id) {
                    graph[id]['id'] = obj.id
                    return
                }
                if(key === '_type') return
                graph[id][key] = obj[key]
            })
        })
        return graph
    }
}

class DocGraph {
    constructor(settings) {
        this.graph = new ObjectSyncProtocol(settings)
    }

    onChange(cb) {
        return this.graph.onChange(cb)
    }

    process(op) {
        return this.graph.process(op)
    }

    getObjectByProperty(key, value) {
        return this.graph.getObjectByProperty(key, value)
    }

    getPropertyValue(objid, key) {
        return this.graph.getPropertyValue(objid, key)
    }

    hasPropertyValue(objid, key) {
        return this.graph.hasPropertyValue(objid, key)
    }

    getPropertiesForObject(objid) {
        return this.graph.getPropertiesForObject(objid)
    }

    dumpGraph() {
        return this.graph.dumpGraph()
    }

    createObject() {
        const op = {
            type: EVENT_TYPES.CREATE_OBJECT,
            id: this.graph.makeGUID(),
            host: this.graph.getHostId()
        }
        return this.graph.process(op)
    }

    createProperty(id, name, value) {
        const op = {
            type: EVENT_TYPES.CREATE_PROPERTY,
            host: this.graph.getHostId(),
            object: id,
            name: name,
            value: value
        }
        return this.graph.process(op)
    }

    setProperty(id, name, value) {
        const op = {
            type: EVENT_TYPES.SET_PROPERTY,
            host: this.graph.getHostId(),
            object: id,
            name: name,
            value: value
        }
        return this.graph.process(op)
    }

    deleteProperty(id, name) {
        const op = {
            type: EVENT_TYPES.DELETE_PROPERTY,
            host: this.graph.getHostId(),
            object: id,
            name: name,
        }
        return this.graph.process(op)
    }

    deleteObject(id) {
        const op = {
            type: EVENT_TYPES.DELETE_OBJECT,
            host: this.graph.getHostId(),
            id: id,
        }
        return this.graph.process(op)
    }

    createArray() {
        const op = {
            type: EVENT_TYPES.CREATE_ARRAY,
            host: this.graph.getHostId(),
            id: this.graph.makeGUID(),
        }
        return this.graph.process(op)
    }
}

class HistoryView {
    constructor(graph) {
        this.history = []
        this.listeners = []
        graph.onChange((e)=>{
            const obj = { type:e.type}
            if(e.type === EVENT_TYPES.CREATE_PROPERTY || e.type === EVENT_TYPES.SET_PROPERTY) {
                obj.name = e.name
                obj.value = e.value
            }
            this.history.push(obj)
            this.fire(obj)
        })
    }
    onChange(cb) {
        this.listeners.push(cb)
    }
    fire(obj) {
        this.listeners.forEach(cb => cb(obj))
    }
    dump() {
        return this.history
    }
}

module.exports.ObjectSyncProtocol = ObjectSyncProtocol
module.exports.DocGraph = DocGraph
module.exports.HistoryView = HistoryView
Object.keys(EVENT_TYPES).forEach(key => {
    module.exports[key] = EVENT_TYPES[key]
})
